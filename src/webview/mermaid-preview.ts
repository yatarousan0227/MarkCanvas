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
  return value || fallback;
}

function getMermaidThemeVariables() {
  const background = getThemeColor('--rm-bg', '#ffffff');
  const text = getThemeColor('--rm-fg', '#1f2328');
  const heading = getThemeColor('--rm-heading', text);
  const primary = getThemeColor('--rm-primary', '#0969da');
  const surface = getThemeColor('--rm-widget-bg', background);
  const surfaceLow = getThemeColor('--rm-surface-low', surface);
  const border = getThemeColor('--rm-widget-border', primary);
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
  const previewHandleIds = new WeakMap<MermaidPreviewApply, number>();
  const previewHandles = new Map<number, {
    applyPreviewRef: WeakRef<MermaidPreviewApply>;
    renderVersion: number;
    source: string;
  }>();
  const previewHandleFinalizer = typeof FinalizationRegistry === 'undefined'
    ? null
    : new FinalizationRegistry<number>((handleId) => {
      previewHandles.delete(handleId);
    });

  function cleanupDeadHandles(): void {
    for (const [handleId, previewHandle] of Array.from(previewHandles.entries())) {
      if (!previewHandle.applyPreviewRef.deref()) {
        previewHandles.delete(handleId);
      }
    }
  }

  function getEffectivePreviewTheme(themeState: MermaidThemeState): 'light' | 'dark' {
    if (themeState.previewTheme === 'light' || themeState.previewTheme === 'dark') {
      return themeState.previewTheme;
    }

    return themeState.hostThemeKind === 'light' ? 'light' : 'dark';
  }

  function syncTheme(themeState: MermaidThemeState): void {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      // Use plain SVG text labels because foreignObject-based labels can disappear inside VS Code webviews.
      htmlLabels: false,
      // Keep Mermaid parse errors inside our inline banner instead of leaving a global error SVG in the document.
      suppressErrorRendering: true,
      theme: 'base',
      darkMode: getEffectivePreviewTheme(themeState) === 'dark',
      themeVariables: getMermaidThemeVariables(),
    });
  }

  async function renderPreviewContent(
    handleId: number,
    applyPreview: MermaidPreviewApply,
    content: string,
  ): Promise<void> {
    const previewVersion = previewCounter += 1;
    const renderId = `mermaid-preview-${previewVersion}`;

    previewHandles.set(handleId, {
      applyPreviewRef: new WeakRef(applyPreview),
      renderVersion: previewVersion,
      source: content,
    });
    applyPreview('<div class="mermaid-preview mermaid-preview--loading"></div>');

    try {
      const result = await mermaid.render(renderId, content);
      if (previewHandles.get(handleId)?.renderVersion !== previewVersion) {
        return;
      }

      applyPreview(`<div class="mermaid-preview">${result.svg}</div>`);
    } catch (error) {
      if (previewHandles.get(handleId)?.renderVersion !== previewVersion) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unable to render Mermaid.';
      applyPreview(`<div class="mermaid-error-banner">${escapeHtml(message)}</div>`);
      options.reportError(message);
    }
  }

  function renderPreview(
    language: string,
    content: string,
    applyPreview: MermaidPreviewApply,
  ): void | null {
    if (language.trim().toLowerCase() !== 'mermaid' || content.trim().length === 0) {
      return null;
    }

    cleanupDeadHandles();
    let handleId = previewHandleIds.get(applyPreview);
    if (handleId == null) {
      handleId = previewHandleCounter += 1;
      previewHandleIds.set(applyPreview, handleId);
      previewHandleFinalizer?.register(applyPreview, handleId, applyPreview);
    }

    void renderPreviewContent(handleId, applyPreview, content);
  }

  function rerender(): void {
    cleanupDeadHandles();
    for (const [handleId, previewHandle] of Array.from(previewHandles.entries())) {
      const applyPreview = previewHandle.applyPreviewRef.deref();
      if (!applyPreview) {
        previewHandles.delete(handleId);
        continue;
      }

      void renderPreviewContent(handleId, applyPreview, previewHandle.source);
    }
  }

  return {
    renderPreview,
    rerender,
    syncTheme,
  };
}
