export interface ResourceDescriptor {
  original: string;
  resolved: string | null;
  exists: boolean;
  isDrawio: boolean;
  openTarget: string | null;
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
    }
  | {
      type: 'themeChanged';
      themeKind: 'light' | 'dark' | 'hc';
    }
  | {
      type: 'openResourceResult';
      ok: boolean;
      target: string | null;
      error?: string;
    };

export type WebviewToExtensionMessage =
  | {
      type: 'applyMarkdown';
      markdown: string;
      version: number;
    }
  | {
      type: 'openDrawioFile';
      target: string;
    }
  | {
      type: 'reportRenderError';
      source: 'mermaid' | 'milkdown';
      message: string;
    };
