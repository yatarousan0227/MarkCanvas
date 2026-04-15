import mermaid from 'mermaid';
import type { HostThemeKind, PreviewTheme } from './view-types';

export type MermaidPreviewApply = (value: string | HTMLElement | null) => void;

type MermaidPreviewManagerOptions = {
  reportError: (message: string) => void;
};

type MermaidThemeState = {
  hostThemeKind: HostThemeKind;
  previewTheme: PreviewTheme;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function getThemeColor(name: string, fallback: string): string {
  const value = window.getComputedStyle(document.body).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

function getEffectivePreviewTheme(themeState: MermaidThemeState): 'light' | 'dark' {
  if (themeState.previewTheme === 'light' || themeState.previewTheme === 'dark') {
    return themeState.previewTheme;
  }

  return themeState.hostThemeKind === 'light' ? 'light' : 'dark';
}

function getMermaidThemeVariables() {
  const background = getThemeColor('--rm-bg', '#ffffff');
  const text = getThemeColor('--rm-fg', '#1f2328');
  const heading = getThemeColor('--rm-heading', text);
  const primary = getThemeColor('--rm-primary', '#0969da');
  const surface = getThemeColor('--rm-surface', background);
  const surfaceLow = getThemeColor('--rm-surface-low', surface);
  const border = getThemeColor('--rm-outline', primary);
  const codeBackground = getThemeColor('--rm-code-bg', surfaceLow);
  const quoteBackground = getThemeColor('--rm-quote-bg', surfaceLow);
  const error = getThemeColor('--rm-error', '#d1242f');
  const fontFamily = getThemeColor('--rm-font-ui', 'Arial, sans-serif');

  return {
    background,
    mainBkg: surface,
    primaryColor: surface,
    primaryTextColor: text,
    primaryBorderColor: border,
    secondaryColor: surfaceLow,
    secondaryTextColor: text,
    secondaryBorderColor: border,
    tertiaryColor: quoteBackground,
    tertiaryTextColor: text,
    tertiaryBorderColor: border,
    lineColor: primary,
    textColor: text,
    titleColor: heading,
    edgeLabelBackground: background,
    clusterBkg: codeBackground,
    clusterBorder: border,
    noteBkg: quoteBackground,
    noteTextColor: text,
    noteBorderColor: border,
    actorBkg: surface,
    actorTextColor: text,
    actorBorder: border,
    signalColor: text,
    signalTextColor: text,
    labelBoxBkgColor: surface,
    labelTextColor: text,
    loopTextColor: text,
    activationBkgColor: surfaceLow,
    activationBorderColor: border,
    errorBkgColor: quoteBackground,
    errorTextColor: error,
    fontFamily,
  };
}

export function createMermaidPreviewManager(options: MermaidPreviewManagerOptions) {
  let previewCounter = 0;
  let previewHandleCounter = 0;
  const previewHandles = new Map<string, {
    renderVersion: number;
    source: string;
    awaitingMount: boolean;
    disconnectMountObserver: (() => void) | null;
  }>();

  function getPreviewSelector(previewId: string): string {
    return `[data-markcanvas-mermaid-preview-id="${previewId}"]`;
  }

  function getPreviewElement(previewId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(getPreviewSelector(previewId));
  }

  function cleanupDeadHandles(): void {
    for (const [previewId, previewHandle] of Array.from(previewHandles.entries())) {
      if (previewHandle.awaitingMount || getPreviewElement(previewId)) {
        continue;
      }

      previewHandle.disconnectMountObserver?.();
      previewHandles.delete(previewId);
    }
  }

  function setPreviewContent(previewId: string, className: string, markup: string): boolean {
    const previewElement = getPreviewElement(previewId);
    if (!previewElement) {
      return false;
    }

    previewElement.className = className;
    previewElement.innerHTML = markup;
    return true;
  }

  function mountPreviewHandle(previewId: string): void {
    const previewHandle = previewHandles.get(previewId);
    if (!previewHandle) {
      return;
    }

    previewHandle.awaitingMount = false;
    previewHandle.disconnectMountObserver?.();
    previewHandle.disconnectMountObserver = null;
    void renderPreviewContent(previewId, previewHandle.source);
  }

  function observePreviewMount(previewId: string): void {
    const previewHandle = previewHandles.get(previewId);
    if (!previewHandle || previewHandle.disconnectMountObserver) {
      return;
    }

    if (getPreviewElement(previewId)) {
      mountPreviewHandle(previewId);
      return;
    }

    const observer = new MutationObserver(() => {
      if (!getPreviewElement(previewId)) {
        return;
      }

      observer.disconnect();
      mountPreviewHandle(previewId);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    previewHandle.disconnectMountObserver = () => {
      observer.disconnect();
    };
  }

  function syncTheme(themeState: MermaidThemeState): void {
    const effectiveTheme = getEffectivePreviewTheme(themeState);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      // Use plain SVG text labels because foreignObject-based labels can disappear inside VS Code webviews.
      htmlLabels: false,
      // Keep Mermaid parse errors inside our inline banner instead of leaving a global error SVG in the document.
      suppressErrorRendering: true,
      // Some Mermaid renderers branch on the theme name itself, not only themeVariables.
      theme: effectiveTheme === 'light' ? 'default' : 'dark',
      darkMode: effectiveTheme === 'dark',
      themeVariables: getMermaidThemeVariables(),
    });
  }

  async function renderPreviewContent(
    handleId: string,
    content: string,
  ): Promise<void> {
    const previewVersion = previewCounter += 1;
    const renderId = `mermaid-preview-${previewVersion}`;
    const previewHandle = previewHandles.get(handleId);
    if (!previewHandle) {
      return;
    }

    previewHandle.renderVersion = previewVersion;
    previewHandle.source = content;
    const loadingApplied = setPreviewContent(handleId, 'mermaid-preview mermaid-preview--loading', '');
    if (!loadingApplied) {
      return;
    }

    try {
      const result = await mermaid.render(renderId, content);
      if (previewHandles.get(handleId)?.renderVersion !== previewVersion) {
        return;
      }

      setPreviewContent(handleId, 'mermaid-preview', result.svg);
    } catch (error) {
      if (previewHandles.get(handleId)?.renderVersion !== previewVersion) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unable to render Mermaid.';
      setPreviewContent(handleId, 'mermaid-preview', `<div class="mermaid-error-banner">${escapeHtml(message)}</div>`);
      options.reportError(message);
    }
  }

  function renderPreview(
    language: string,
    content: string,
    _applyPreview: MermaidPreviewApply,
  ): string | void | null {
    if (language.trim().toLowerCase() !== 'mermaid' || content.trim().length === 0) {
      return null;
    }

    cleanupDeadHandles();
    const handleId = `markcanvas-mermaid-preview-${previewHandleCounter += 1}`;
    previewHandles.set(handleId, {
      renderVersion: 0,
      source: content,
      awaitingMount: true,
      disconnectMountObserver: null,
    });
    observePreviewMount(handleId);

    return `<div class="mermaid-preview mermaid-preview--loading" data-markcanvas-mermaid-preview-id="${handleId}"></div>`;
  }

  function rerender(): void {
    cleanupDeadHandles();
    for (const [handleId, previewHandle] of Array.from(previewHandles.entries())) {
      if (previewHandle.awaitingMount) {
        continue;
      }

      void renderPreviewContent(handleId, previewHandle.source);
    }
  }

  return {
    renderPreview,
    rerender,
    syncTheme,
  };
}
