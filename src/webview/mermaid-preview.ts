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

export function createMermaidPreviewManager(options: MermaidPreviewManagerOptions) {
  let previewCounter = 0;
  const previewSources = new WeakMap<MermaidPreviewApply, string>();
  const previewRenderVersions = new WeakMap<MermaidPreviewApply, number>();
  const previewAppliers = new Set<MermaidPreviewApply>();

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
      theme: getEffectivePreviewTheme(themeState) === 'light' ? 'default' : 'dark',
    });
  }

  async function renderPreviewContent(
    applyPreview: MermaidPreviewApply,
    content: string,
  ): Promise<void> {
    const previewVersion = previewCounter += 1;
    const renderId = `mermaid-preview-${previewVersion}`;

    previewSources.set(applyPreview, content);
    previewRenderVersions.set(applyPreview, previewVersion);
    previewAppliers.add(applyPreview);
    applyPreview('<div class="mermaid-preview mermaid-preview--loading"></div>');

    try {
      const result = await mermaid.render(renderId, content);
      if (previewRenderVersions.get(applyPreview) !== previewVersion) {
        return;
      }

      applyPreview(`<div class="mermaid-preview">${result.svg}</div>`);
    } catch (error) {
      if (previewRenderVersions.get(applyPreview) !== previewVersion) {
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

    void renderPreviewContent(applyPreview, content);
  }

  function rerender(): void {
    for (const applyPreview of Array.from(previewAppliers)) {
      const source = previewSources.get(applyPreview);
      if (!source) {
        continue;
      }

      void renderPreviewContent(applyPreview, source);
    }
  }

  return {
    renderPreview,
    rerender,
    syncTheme,
  };
}

