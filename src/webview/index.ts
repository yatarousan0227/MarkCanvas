import '@milkdown/crepe/theme/common/style.css';
import 'katex/dist/katex.min.css';
import './styles.css';
import { LanguageDescription } from '@codemirror/language';
import { languages as defaultCodeBlockLanguages } from '@codemirror/language-data';
import type { Editor } from '@milkdown/kit/core';
import { editorViewCtx } from '@milkdown/kit/core';
import { Crepe } from '@milkdown/crepe';
import type {
  DocumentPayload,
  ExtensionToWebviewMessage,
  ResourceDescriptor,
  WebviewToExtensionMessage,
} from '../types';
import { createDrawioOverlayManager } from './drawio';
import { createEditIntentTracker } from './edit-intent';
import { renderHtmlPreviews } from './html-preview';
import { createMarkdownEditorBridge } from './markdown-editor';
import { createMarkdownSnapshot, type MarkdownSnapshot } from './markdown-reconciler';
import { createMermaidPreviewManager } from './mermaid-preview';
import { createTableWidthManager } from './table-width-plugin';
import { createTableWidthState, type TableWidthState } from './table-widths';
import {
  createThemeControlsManager,
} from './theme-controls';
import { createTopBarConfig } from './topbar';
import type { HostThemeKind, PreviewTheme } from './view-types';

declare global {
  interface Window {
    acquireVsCodeApi(): {
      postMessage(message: WebviewToExtensionMessage): void;
      getState(): {
        previewTheme?: PreviewTheme;
        viewportScrollX?: number;
        viewportScrollY?: number;
      } | undefined;
      setState(state: {
        viewportScrollX?: number;
        viewportScrollY?: number;
      }): void;
    };
  }
}

const vscode = window.acquireVsCodeApi();
const initialState = vscode.getState();

let payload: DocumentPayload | undefined;
let currentVersion = payload?.version ?? 0;
let previewTheme: PreviewTheme = initialState?.previewTheme ?? 'system';
let hostThemeKind: HostThemeKind = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

let suppressUpdates = false;
let markdownUpdateInFlight = false;
let queuedMarkdownUpdate: string | null = null;
let editorInstance: Editor | null = null;
let crepe: Crepe | null = null;
let baselineMarkdownSnapshot: MarkdownSnapshot | null = null;
let tableWidthState: TableWidthState = createTableWidthState(payload?.markdown ?? '');
let tableWidthManager: ReturnType<typeof createTableWidthManager> | null = null;
let viewportStateFrame = 0;
let pendingInitialViewportScroll = initialState
  && Number.isFinite(initialState.viewportScrollX)
  && Number.isFinite(initialState.viewportScrollY)
  ? {
      x: initialState.viewportScrollX ?? 0,
      y: initialState.viewportScrollY ?? 0,
    }
  : null;

const resourceCache = new Map<string, ResourceDescriptor>();
const resolvedResourceCache = new Map<string, ResourceDescriptor>();

const markdownLanguage = defaultCodeBlockLanguages.find((language) => language.name === 'Markdown');
const codeBlockLanguages = [
  ...defaultCodeBlockLanguages,
  // Mermaid blocks are preview-driven here, so a lightweight text-oriented mode is sufficient for editing.
  LanguageDescription.of({
    name: 'mermaid',
    load: () => markdownLanguage?.load() ?? Promise.reject(new Error('Markdown language support is unavailable.')),
  }),
  // Reuse Markdown's mostly text-oriented mode so pseudocode can be selected without custom grammar work.
  LanguageDescription.of({
    name: 'pseudocode',
    alias: ['pseudo', 'psuedocode'],
    load: () => markdownLanguage?.load() ?? Promise.reject(new Error('Markdown language support is unavailable.')),
  }),
];

const themeControls = createThemeControlsManager({
  getPreviewTheme: () => previewTheme,
  setPreviewTheme: (theme) => {
    setPreviewTheme(theme);
  },
});

const mermaidPreview = createMermaidPreviewManager({
  reportError: (message) => {
    postMessage({
      type: 'reportRenderError',
      source: 'mermaid',
      message,
    });
  },
});

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function postMessage(message: WebviewToExtensionMessage): void {
  vscode.postMessage(message);
}

const drawioOverlay = createDrawioOverlayManager({
  postMessage,
});

const editIntent = createEditIntentTracker({
  prepareTableOperation: (target) => {
    tableWidthManager?.prepareTableOperation(target);
  },
});

const markdownEditor = createMarkdownEditorBridge({
  getBaselineMarkdownSnapshot: () => baselineMarkdownSnapshot,
  getCrepe: () => crepe,
  getEditorInstance: () => editorInstance,
  getTableWidthState: () => tableWidthState,
  setSuppressUpdates: (value) => {
    suppressUpdates = value;
  },
  clearUserEditIntent: () => {
    editIntent.clear();
  },
  sendMarkdownUpdate: (markdown) => {
    sendMarkdownUpdate(markdown);
  },
  refreshEditorDecorations: () => {
    refreshEditorDecorations();
  },
});

function persistState(): void {
  vscode.setState({
    viewportScrollX: window.scrollX,
    viewportScrollY: window.scrollY,
  });
}

function scheduleViewportStatePersist(): void {
  if (viewportStateFrame !== 0) {
    return;
  }

  viewportStateFrame = window.requestAnimationFrame(() => {
    viewportStateFrame = 0;
    persistState();
  });
}

function getThemeState(): { hostThemeKind: HostThemeKind; previewTheme: PreviewTheme } {
  return { hostThemeKind, previewTheme };
}

function refreshPreviewTheme(): void {
  document.body.dataset.theme = hostThemeKind;
  document.body.dataset.previewTheme = previewTheme;
  mermaidPreview.syncTheme(getThemeState());
  themeControls.updateControls();
}

function renderFatalError(message: string): void {
  const app = document.getElementById('app');
  if (!app) {
    return;
  }

  app.innerHTML = `
    <div class="fatal-error">
      <h2>MarkCanvas failed to load</h2>
      <pre>${escapeHtml(message)}</pre>
    </div>
  `;
}

function decorateImages(): void {
  renderHtmlPreviews({
    resourceCache,
    resolvedResourceCache,
  });
  drawioOverlay.render({
    resourceCache,
    resolvedResourceCache,
  });
}

function refreshEditorDecorations(): void {
  decorateImages();
  tableWidthManager?.refresh();
}

function sendMarkdownUpdate(markdown: string): void {
  if (!payload) {
    return;
  }

  if (markdown === payload.markdown) {
    return;
  }

  if (markdownUpdateInFlight) {
    queuedMarkdownUpdate = markdown;
    return;
  }

  markdownUpdateInFlight = true;
  queuedMarkdownUpdate = null;
  postMessage({
    type: 'applyMarkdown',
    markdown,
    version: currentVersion,
  });
}

function restoreViewportScroll(x: number, y: number): void {
  window.scrollTo(x, y);
}

function restoreInitialViewportScroll(): void {
  if (!pendingInitialViewportScroll) {
    return;
  }

  const { x, y } = pendingInitialViewportScroll;
  pendingInitialViewportScroll = null;
  restoreViewportScroll(x, y);
  requestAnimationFrame(() => {
    restoreViewportScroll(x, y);
    requestAnimationFrame(() => {
      restoreViewportScroll(x, y);
      persistState();
    });
  });
}

function applyPayload(next: DocumentPayload): void {
  payload = next;
  currentVersion = next.version;
  markdownUpdateInFlight = false;
  editIntent.clear();
  baselineMarkdownSnapshot = createMarkdownSnapshot(next.markdown);
  tableWidthState = createTableWidthState(next.markdown);
  resourceCache.clear();
  resolvedResourceCache.clear();

  for (const resource of next.resources) {
    resourceCache.set(resource.original, resource);
    if (resource.resolved) {
      resolvedResourceCache.set(resource.resolved, resource);
    }
  }

  persistState();
  queueMicrotask(() => {
    tableWidthManager?.refresh();
  });

  if (queuedMarkdownUpdate && queuedMarkdownUpdate !== next.markdown) {
    const pendingMarkdown = queuedMarkdownUpdate;
    queuedMarkdownUpdate = null;
    queueMicrotask(() => {
      sendMarkdownUpdate(pendingMarkdown);
    });
  }
}

function setPreviewTheme(nextTheme: PreviewTheme): void {
  if (previewTheme === nextTheme) {
    return;
  }

  previewTheme = nextTheme;
  persistState();
  refreshPreviewTheme();
  mermaidPreview.rerender();
  postMessage({
    type: 'setPreviewTheme',
    previewTheme: nextTheme,
  });
}

async function createEditor(initial: DocumentPayload): Promise<void> {
  applyPayload(initial);
  refreshPreviewTheme();

  try {
    crepe = new Crepe({
      root: '#app',
      defaultValue: initial.markdown,
      features: {
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.Latex]: true,
        [Crepe.Feature.TopBar]: true,
      },
      featureConfigs: {
        [Crepe.Feature.TopBar]: createTopBarConfig({
          onUserEditIntent: () => {
            editIntent.mark();
          },
          onRequestImageInsertion: () => {
            postMessage({
              type: 'requestImageInsertion',
            });
          },
        }),
        [Crepe.Feature.CodeMirror]: {
          languages: codeBlockLanguages,
          renderPreview: mermaidPreview.renderPreview,
          previewOnlyByDefault: true,
          previewLabel: 'Preview',
          previewToggleText: (previewOnlyMode: boolean) => (previewOnlyMode ? 'Source' : 'Hide preview'),
        },
        [Crepe.Feature.ImageBlock]: {
          proxyDomURL: (originalUrl: string) => resourceCache.get(originalUrl)?.resolved ?? originalUrl,
        },
      },
    });
    markdownEditor.configureMarkdownSerialization();
    tableWidthManager = createTableWidthManager({
      getState: () => tableWidthState,
      dispatchResizeTransaction: () => {
        editorInstance?.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.dispatch(view.state.tr.setMeta('markcanvasTableWidthResize', true));
        });
      },
      onCommit: () => {
        if (!crepe) {
          return;
        }

        editIntent.mark();
        const nextMarkdown = markdownEditor.reconstructMarkdownForSave(crepe.getMarkdown());
        editIntent.clear();
        sendMarkdownUpdate(nextMarkdown);
      },
    });

    crepe.on((api) => {
      api.markdownUpdated((_, markdown) => {
        if (suppressUpdates) {
          return;
        }

        if (!editIntent.consume()) {
          return;
        }

        sendMarkdownUpdate(markdownEditor.reconstructMarkdownForSave(markdown));
        queueMicrotask(() => {
          refreshEditorDecorations();
        });
      });
    });

    editorInstance = await crepe.create();
    editIntent.install(document.getElementById('app'));
    restoreInitialViewportScroll();
    themeControls.ensureControls();
    refreshEditorDecorations();
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown initialization error.';
    postMessage({
      type: 'reportRenderError',
      source: 'milkdown',
      message,
    });
    renderFatalError(message);
  }
}

window.addEventListener('scroll', () => {
  scheduleViewportStatePersist();
}, { passive: true });

window.addEventListener('beforeunload', () => {
  if (viewportStateFrame !== 0) {
    window.cancelAnimationFrame(viewportStateFrame);
    viewportStateFrame = 0;
  }
  persistState();
  drawioOverlay.destroy();
  tableWidthManager?.destroy();
}, { once: true });

function handleMessage(message: ExtensionToWebviewMessage): void {
  switch (message.type) {
    case 'initDocument':
      if (!editorInstance) {
        void createEditor(message.payload);
      }
      return;
    case 'replaceDocument':
      applyPayload(message.payload);
      if (message.origin !== 'self') {
        markdownEditor.setEditorMarkdown(message.payload.markdown);
      }
      queueMicrotask(() => {
        refreshEditorDecorations();
      });
      return;
    case 'themeChanged':
      hostThemeKind = message.themeKind;
      refreshPreviewTheme();
      if (previewTheme === 'system') {
        mermaidPreview.rerender();
      }
      return;
    case 'previewThemeChanged':
      if (previewTheme === message.previewTheme) {
        return;
      }

      previewTheme = message.previewTheme;
      refreshPreviewTheme();
      mermaidPreview.rerender();
      return;
    case 'openResourceResult':
      if (!message.ok && message.error) {
        postMessage({
          type: 'reportRenderError',
          source: 'milkdown',
          message: message.error,
        });
      }
      return;
    case 'insertImageResult':
      if (message.ok && message.markdown) {
        markdownEditor.insertMarkdownAtSelection(message.markdown);
        return;
      }

      editIntent.clear();
      if (message.error) {
        postMessage({
          type: 'reportRenderError',
          source: 'milkdown',
          message: message.error,
        });
      }
      return;
  }
}

window.addEventListener('message', (event: MessageEvent<ExtensionToWebviewMessage>) => {
  handleMessage(event.data);
});

window.addEventListener('error', (event) => {
  const message = event.error instanceof Error ? `${event.error.name}: ${event.error.message}` : event.message;
  renderFatalError(message);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}` : String(event.reason);
  renderFatalError(reason);
});
