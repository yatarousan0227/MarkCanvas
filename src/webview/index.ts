import '@milkdown/crepe/theme/common/style.css';
import 'katex/dist/katex.min.css';
import './styles.css';
import { LanguageDescription } from '@codemirror/language';
import { languages as defaultCodeBlockLanguages } from '@codemirror/language-data';
import type { Editor } from '@milkdown/kit/core';
import { editorViewCtx, parserCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { Slice } from '@milkdown/kit/prose/model';
import { Selection, TextSelection } from '@milkdown/kit/prose/state';
import { Crepe } from '@milkdown/crepe';
import type {
  DocumentPayload,
  ExtensionToWebviewMessage,
  ResourceDescriptor,
  WebviewToExtensionMessage,
} from '../types';
import { createDrawioOverlayManager } from './drawio';
import { renderHtmlPreviews } from './html-preview';
import { createMarkdownSnapshot, reconcileMarkdownSnapshots, type MarkdownSnapshot } from './markdown-reconciler';
import { createMermaidPreviewManager } from './mermaid-preview';
import {
  createThemeControlsManager,
} from './theme-controls';
import { createTopBarConfig } from './topbar';
import type { HostThemeKind, PreviewTheme } from './view-types';

declare global {
  interface Window {
    acquireVsCodeApi(): {
      postMessage(message: WebviewToExtensionMessage): void;
      getState(): { payload?: DocumentPayload; previewTheme?: PreviewTheme } | undefined;
      setState(state: { payload?: DocumentPayload; previewTheme?: PreviewTheme }): void;
    };
  }
}

const vscode = window.acquireVsCodeApi();

let payload = vscode.getState()?.payload;
let currentVersion = payload?.version ?? 0;
let previewTheme: PreviewTheme = vscode.getState()?.previewTheme ?? 'system';
let hostThemeKind: HostThemeKind = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

let suppressUpdates = false;
let markdownUpdateInFlight = false;
let queuedMarkdownUpdate: string | null = null;
let editorInstance: Editor | null = null;
let crepe: Crepe | null = null;
let baselineMarkdownSnapshot: MarkdownSnapshot | null = null;
let pendingUserEditIntent = false;

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

function persistState(): void {
  vscode.setState({ payload, previewTheme });
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

function markUserEditIntent(): void {
  pendingUserEditIntent = true;
}

function clearUserEditIntent(): void {
  pendingUserEditIntent = false;
}

function consumeUserEditIntent(): boolean {
  const shouldApply = pendingUserEditIntent;
  pendingUserEditIntent = false;
  return shouldApply;
}

function shouldTreatKeydownAsEditIntent(event: KeyboardEvent): boolean {
  if (event.isComposing) {
    return true;
  }

  if (event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Tab') {
    return true;
  }

  if ((event.metaKey || event.ctrlKey) && /^[a-z0-9]$/i.test(event.key)) {
    return true;
  }

  return false;
}

function installUserEditIntentTracking(): void {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  const markStructuredEditIntent = (eventTarget: EventTarget | null): void => {
    if (!(eventTarget instanceof HTMLInputElement)) {
      if (!(eventTarget instanceof Element)) {
        return;
      }

      if (eventTarget.closest('.milkdown-list-item-block .label-wrapper')) {
        markUserEditIntent();
      }

      return;
    }

    if (eventTarget.type !== 'checkbox') {
      return;
    }

    markUserEditIntent();
  };

  root.addEventListener('beforeinput', () => {
    markUserEditIntent();
  }, true);
  root.addEventListener('paste', () => {
    markUserEditIntent();
  }, true);
  root.addEventListener('cut', () => {
    markUserEditIntent();
  }, true);
  root.addEventListener('drop', () => {
    markUserEditIntent();
  }, true);
  root.addEventListener('pointerdown', (event) => {
    markStructuredEditIntent(event.target);
  }, true);
  root.addEventListener('click', (event) => {
    markStructuredEditIntent(event.target);
  }, true);
  root.addEventListener('change', (event) => {
    markStructuredEditIntent(event.target);
  }, true);
  root.addEventListener('keydown', (event) => {
    if (shouldTreatKeydownAsEditIntent(event)) {
      markUserEditIntent();
    }
  }, true);
}

function preserveLiteralText(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9./_-]*$/.test(value);
}

function normalizeEscapedText(value: string): string {
  return value
    .replace(/\\\./g, '.')
    .replace(/([A-Za-z0-9./-])\\_([A-Za-z0-9./-])/g, '$1_$2')
    .replace(/([A-Za-z0-9])\\\*([A-Za-z0-9])/g, '$1*$2')
    .replace(/\\\[([^[\]\r\n]+)](?!\(|\[)/g, '[$1]');
}

function configureMarkdownSerialization(): void {
  if (!crepe) {
    return;
  }

  crepe.editor.config((ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (value) => ({
      ...value,
      bullet: '-' as const,
      join: [
        (left, right, parent) => {
          if (parent && (parent.type === 'list' || parent.type === 'listItem')) {
            return 0;
          }

          return undefined;
        },
      ],
      handlers: {
        ...value.handlers,
        text: (node, _, state, info) => {
          const text = typeof node.value === 'string' ? node.value : '';
          if (preserveLiteralText(text) || /^[^*_\\]*\s+$/.test(text)) {
            return text;
          }

          return normalizeEscapedText(state.safe(text, {
            ...info,
            encode: [],
          }));
        },
      },
    }));
  });
}

function insertMarkdownAtSelection(markdown: string): void {
  if (!editorInstance) {
    return;
  }

  suppressUpdates = true;
  try {
    editorInstance.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parser = ctx.get(parserCtx);
      const doc = parser(markdown);
      if (!doc) {
        return;
      }

      const contentSlice = view.state.selection.content();
      const replacement = new Slice(doc.content, contentSlice.openStart, contentSlice.openEnd);
      view.dispatch(view.state.tr.replaceSelection(replacement).scrollIntoView());
    });
  } finally {
    suppressUpdates = false;
  }

  if (!crepe) {
    return;
  }

  const nextMarkdown = reconstructMarkdownForSave(crepe.getMarkdown());
  clearUserEditIntent();
  sendMarkdownUpdate(nextMarkdown);
  queueMicrotask(() => {
    decorateImages();
  });
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

function reconstructMarkdownForSave(markdown: string): string {
  if (!baselineMarkdownSnapshot) {
    return markdown;
  }

  try {
    return reconcileMarkdownSnapshots(
      baselineMarkdownSnapshot,
      createMarkdownSnapshot(markdown),
    );
  } catch {
    return markdown;
  }
}

function shouldSkipMarkdownReset(markdown: string, force: boolean): boolean {
  if (!crepe) {
    return true;
  }

  const currentMarkdown = crepe.getMarkdown();
  if (currentMarkdown === markdown) {
    return true;
  }

  if (force) {
    return false;
  }

  try {
    return reconstructMarkdownForSave(currentMarkdown) === markdown;
  } catch {
    return false;
  }
}

function clampSelectionPosition(position: number, size: number): number {
  return Math.max(0, Math.min(position, size));
}

function restoreViewportScroll(x: number, y: number): void {
  window.scrollTo(x, y);
}

function applyPayload(next: DocumentPayload): void {
  payload = next;
  currentVersion = next.version;
  markdownUpdateInFlight = false;
  clearUserEditIntent();
  baselineMarkdownSnapshot = createMarkdownSnapshot(next.markdown);
  resourceCache.clear();
  resolvedResourceCache.clear();

  for (const resource of next.resources) {
    resourceCache.set(resource.original, resource);
    if (resource.resolved) {
      resolvedResourceCache.set(resource.resolved, resource);
    }
  }

  persistState();

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
}

function setEditorMarkdown(markdown: string, force = false): void {
  if (!editorInstance || shouldSkipMarkdownReset(markdown, force)) {
    return;
  }

  suppressUpdates = true;
  clearUserEditIntent();
  const previousScrollX = window.scrollX;
  const previousScrollY = window.scrollY;
  try {
    editorInstance.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parser = ctx.get(parserCtx);
      const doc = parser(markdown);
      if (!doc) {
        return;
      }

      const { state } = view;
      let tr = state.tr.replace(0, state.doc.content.size, new Slice(doc.content, 0, 0));
      const anchor = clampSelectionPosition(state.selection.anchor, tr.doc.content.size);
      const head = clampSelectionPosition(state.selection.head, tr.doc.content.size);

      try {
        tr = state.selection instanceof TextSelection
          ? tr.setSelection(TextSelection.between(tr.doc.resolve(anchor), tr.doc.resolve(head)))
          : tr.setSelection(Selection.near(tr.doc.resolve(anchor)));
      } catch {
        tr = tr.setSelection(Selection.near(tr.doc.resolve(anchor)));
      }

      view.dispatch(tr);
    });
  } finally {
    suppressUpdates = false;
  }

  restoreViewportScroll(previousScrollX, previousScrollY);
  requestAnimationFrame(() => {
    restoreViewportScroll(previousScrollX, previousScrollY);
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
            markUserEditIntent();
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
    configureMarkdownSerialization();

    crepe.on((api) => {
      api.markdownUpdated((_, markdown) => {
        if (suppressUpdates) {
          return;
        }

        if (!consumeUserEditIntent()) {
          return;
        }

        sendMarkdownUpdate(reconstructMarkdownForSave(markdown));
        queueMicrotask(() => {
          decorateImages();
        });
      });
    });

    editorInstance = await crepe.create();
    installUserEditIntentTracking();
    themeControls.ensureControls();
    decorateImages();
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

window.addEventListener('beforeunload', () => {
  drawioOverlay.destroy();
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
        setEditorMarkdown(message.payload.markdown);
      }
      queueMicrotask(() => {
        decorateImages();
      });
      return;
    case 'themeChanged':
      hostThemeKind = message.themeKind;
      refreshPreviewTheme();
      if (previewTheme === 'system') {
        mermaidPreview.rerender();
      }
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
        insertMarkdownAtSelection(message.markdown);
        return;
      }

      clearUserEditIntent();
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
