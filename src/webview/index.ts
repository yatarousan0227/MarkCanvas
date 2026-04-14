import '@milkdown/crepe/theme/common/style.css';
import 'katex/dist/katex.min.css';
import './styles.css';
import { LanguageDescription } from '@codemirror/language';
import { languages as defaultCodeBlockLanguages } from '@codemirror/language-data';
import type { Editor } from '@milkdown/kit/core';
import { editorViewCtx, parserCtx } from '@milkdown/kit/core';
import { Slice } from '@milkdown/kit/prose/model';
import { Crepe } from '@milkdown/crepe';
import type {
  DocumentPayload,
  ExtensionToWebviewMessage,
  ResourceDescriptor,
  WebviewToExtensionMessage,
} from '../types';
import { decorateDrawioImages } from './drawio';
import { renderHtmlPreviews } from './html-preview';
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
  decorateDrawioImages({
    resourceCache,
    resolvedResourceCache,
    postMessage,
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

function applyPayload(next: DocumentPayload): void {
  payload = next;
  currentVersion = next.version;
  markdownUpdateInFlight = false;
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
  if (!editorInstance || !crepe || (!force && crepe.getMarkdown() === markdown)) {
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

      const { state } = view;
      view.dispatch(state.tr.replace(0, state.doc.content.size, new Slice(doc.content, 0, 0)));
    });
  } finally {
    suppressUpdates = false;
  }
}

async function createEditor(initial: DocumentPayload): Promise<void> {
  applyPayload(initial);
  refreshPreviewTheme();

  try {
    crepe = new Crepe({
      root: '#app',
      defaultValue: initial.markdown,
      features: {
        [Crepe.Feature.Latex]: true,
        [Crepe.Feature.TopBar]: true,
      },
      featureConfigs: {
        [Crepe.Feature.TopBar]: createTopBarConfig(),
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

    crepe.on((api) => {
      api.markdownUpdated((_, markdown) => {
        if (suppressUpdates) {
          return;
        }

        sendMarkdownUpdate(markdown);
        queueMicrotask(() => {
          decorateImages();
        });
      });
    });

    editorInstance = await crepe.create();
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

function handleMessage(message: ExtensionToWebviewMessage): void {
  switch (message.type) {
    case 'initDocument':
      if (!editorInstance) {
        void createEditor(message.payload);
      }
      return;
    case 'replaceDocument':
      applyPayload(message.payload);
      setEditorMarkdown(message.payload.markdown);
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
