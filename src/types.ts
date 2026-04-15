export interface ResourceDescriptor {
  original: string;
  resolved: string | null;
  exists: boolean;
  isDrawio: boolean;
  openTarget: string | null;
  drawioPreviewStatus?: 'ready' | 'unavailable' | 'failed';
  drawioPreviewMessage?: string;
}

export interface DocumentPayload {
  uri: string;
  version: number;
  markdown: string;
  resources: ResourceDescriptor[];
}

export type ExtensionToWebviewMessage =
  | {
      type: 'initDocument' | 'replaceDocument';
      payload: DocumentPayload;
      origin?: 'self' | 'external';
    }
  | {
      type: 'themeChanged';
      themeKind: 'light' | 'dark' | 'hc';
    }
  | {
      type: 'previewThemeChanged';
      previewTheme: 'system' | 'light' | 'dark';
    }
  | {
      type: 'openResourceResult';
      ok: boolean;
      target: string | null;
      error?: string;
    }
  | {
      type: 'insertImageResult';
      ok: boolean;
      cancelled?: boolean;
      markdown?: string;
      error?: string;
    };

export type WebviewToExtensionMessage =
  | {
      type: 'applyMarkdown';
      markdown: string;
      version: number;
    }
  | {
      type: 'setPreviewTheme';
      previewTheme: 'system' | 'light' | 'dark';
    }
  | {
      type: 'openDrawioFile';
      target: string;
    }
  | {
      type: 'requestImageInsertion';
    }
  | {
      type: 'reportRenderError';
      source: 'mermaid' | 'milkdown';
      message: string;
    };
