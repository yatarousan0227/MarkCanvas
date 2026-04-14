import * as path from 'node:path';
import * as vscode from 'vscode';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import { getWebviewHtml } from './html';
import type {
  DocumentPayload,
  ExtensionToWebviewMessage,
  ResourceDescriptor,
  WebviewToExtensionMessage,
} from './types';

type PanelState = {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  applyingVersion: number | null;
  disposed: boolean;
};

export class RenderedMarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'renderedMarkdown.editor';

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const localResourceRoots = [
      this.context.extensionUri,
      ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []),
    ];
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots,
    };
    panel.webview.html = getWebviewHtml(panel.webview, this.context.extensionUri);

    const state: PanelState = {
      panel,
      document,
      applyingVersion: null,
      disposed: false,
    };

    const sendDocument = async (type: 'initDocument' | 'replaceDocument') => {
      if (state.disposed) {
        return;
      }
      const payload = await this.buildPayload(panel.webview, document);
      if (state.disposed) {
        return;
      }
      this.postMessage(state, { type, payload });
    };

    const documentSubscription = vscode.workspace.onDidChangeTextDocument(async (event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      if (state.applyingVersion === event.document.version) {
        state.applyingVersion = null;
      }

      await sendDocument('replaceDocument');
    });

    const themeSubscription = vscode.window.onDidChangeActiveColorTheme(() => {
      this.postMessage(state, {
        type: 'themeChanged',
        themeKind: this.getThemeKind(vscode.window.activeColorTheme),
      });
    });

    panel.onDidDispose(() => {
      state.disposed = true;
      documentSubscription.dispose();
      themeSubscription.dispose();
    });

    panel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      switch (message.type) {
        case 'applyMarkdown':
          await this.applyMarkdown(state, message.markdown, message.version);
          return;
        case 'openDrawioFile':
          await this.openResource(state, message.target);
          return;
        case 'requestImageInsertion':
          await this.promptForImageInsertion(state);
          return;
        case 'reportRenderError':
          console.warn(`[markcanvas] ${message.source}: ${message.message}`);
          return;
      }
    });

    await sendDocument('initDocument');
    this.postMessage(state, {
      type: 'themeChanged',
      themeKind: this.getThemeKind(vscode.window.activeColorTheme),
    });
  }

  private postMessage(state: PanelState, message: ExtensionToWebviewMessage): void {
    if (state.disposed) {
      return;
    }

    try {
      void state.panel.webview.postMessage(message);
    } catch {
      state.disposed = true;
    }
  }

  private async buildPayload(
    webview: vscode.Webview,
    document: vscode.TextDocument,
  ): Promise<DocumentPayload> {
    return {
      uri: document.uri.toString(),
      version: document.version,
      markdown: document.getText(),
      resources: await this.collectResources(webview, document),
    };
  }

  private async applyMarkdown(
    state: PanelState,
    markdown: string,
    version: number,
  ): Promise<void> {
    if (version !== state.document.version) {
      return;
    }

    if (markdown === state.document.getText()) {
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const lastLine = Math.max(state.document.lineCount - 1, 0);
    const lastCharacter = state.document.lineCount > 0
      ? state.document.lineAt(lastLine).range.end.character
      : 0;
    edit.replace(
      state.document.uri,
      new vscode.Range(0, 0, lastLine, lastCharacter),
      markdown,
    );

    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) {
      state.applyingVersion = state.document.version + 1;
    }
  }

  private async collectResources(
    webview: vscode.Webview,
    document: vscode.TextDocument,
  ): Promise<ResourceDescriptor[]> {
    const tree = unified().use(remarkParse).parse(document.getText());
    const seen = new Set<string>();
    const resources: ResourceDescriptor[] = [];

    const urls: string[] = [];
    visit(tree, 'image', (node: { url?: string }) => {
      if (typeof node.url === 'string') {
        urls.push(node.url);
      }
    });

    visit(tree, 'html', (node: { value?: string }) => {
      if (typeof node.value !== 'string') {
        return;
      }

      urls.push(...this.extractHtmlResourceUrls(node.value));
    });

    for (const original of urls) {
      if (seen.has(original)) {
        continue;
      }
      seen.add(original);

      const descriptor = await this.resolveResource(webview, document, original);
      resources.push(descriptor);
    }

    return resources;
  }

  private extractHtmlResourceUrls(html: string): string[] {
    const urls: string[] = [];
    const matches = html.matchAll(/<(?:img|source)\b[^>]*\bsrc\s*=\s*(?:(['"])(.*?)\1|([^\s>]+))/gi);

    for (const match of matches) {
      const url = (match[2] ?? match[3])?.trim();
      if (url) {
        urls.push(url);
      }
    }

    return urls;
  }

  private async resolveResource(
    webview: vscode.Webview,
    document: vscode.TextDocument,
    original: string,
  ): Promise<ResourceDescriptor> {
    if (/^[a-z]+:/i.test(original)) {
      return {
        original,
        resolved: original,
        exists: true,
        isDrawio: false,
        openTarget: null,
      };
    }

    const [resourcePath, suffix] = this.splitResourceReference(original);
    const targetUri = this.resolveWorkspaceUri(document.uri, resourcePath);
    if (!targetUri) {
      return {
        original,
        resolved: null,
        exists: false,
        isDrawio: false,
        openTarget: null,
      };
    }

    try {
      const stat = await vscode.workspace.fs.stat(targetUri);
      if (stat.type !== vscode.FileType.File) {
        return {
          original,
          resolved: null,
          exists: false,
          isDrawio: false,
          openTarget: null,
        };
      }

      const exists = true;
      const isSvg = targetUri.path.toLowerCase().endsWith('.svg');
      const fileBytes = isSvg ? await vscode.workspace.fs.readFile(targetUri) : undefined;
      const fileContent = fileBytes ? Buffer.from(fileBytes).toString('utf8') : '';
      const isDrawio = targetUri.path.toLowerCase().endsWith('.drawio.svg')
        || fileContent.includes('content="&lt;mxfile')
        || fileContent.includes('data-mxgraph=');

      return {
        original,
        resolved: `${webview.asWebviewUri(targetUri).toString()}${suffix}`,
        exists,
        isDrawio,
        openTarget: isDrawio ? targetUri.toString() : null,
      };
    } catch {
      return {
        original,
        resolved: null,
        exists: false,
        isDrawio: false,
        openTarget: null,
      };
    }
  }

  private splitResourceReference(raw: string): [string, string] {
    const hashIndex = raw.indexOf('#');
    const queryIndex = raw.indexOf('?');
    const cutIndex = [hashIndex, queryIndex]
      .filter((index) => index >= 0)
      .reduce((min, index) => Math.min(min, index), raw.length);

    return [raw.slice(0, cutIndex), raw.slice(cutIndex)];
  }

  private resolveWorkspaceUri(documentUri: vscode.Uri, raw: string): vscode.Uri | null {
    if (/^[a-z]+:/i.test(raw)) {
      return null;
    }

    if (raw.startsWith('/')) {
      return vscode.Uri.file(raw);
    }

    const documentDirectory = path.posix.dirname(documentUri.path);
    return vscode.Uri.joinPath(documentUri.with({ path: documentDirectory }), raw);
  }

  private async openResource(state: PanelState, target: string): Promise<void> {
    try {
      const uri = vscode.Uri.parse(target);
      await vscode.commands.executeCommand('vscode.open', uri);
      await this.postOpenResourceResult(state, true, target);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open resource.';
      await this.postOpenResourceResult(state, false, target, message);
    }
  }

  private async postOpenResourceResult(
    state: PanelState,
    ok: boolean,
    target: string | null,
    error?: string,
  ): Promise<void> {
    this.postMessage(state, {
      type: 'openResourceResult',
      ok,
      target,
      error,
    });
  }

  private async promptForImageInsertion(state: PanelState): Promise<void> {
    try {
      const defaultUri = vscode.Uri.joinPath(
        state.document.uri,
        '..',
      );
      const selection = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        defaultUri,
        filters: {
          Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'],
        },
        openLabel: 'Insert Image',
      });

      const imageUri = selection?.[0];
      if (!imageUri) {
        this.postMessage(state, {
          type: 'insertImageResult',
          ok: false,
          cancelled: true,
        });
        return;
      }

      this.postMessage(state, {
        type: 'insertImageResult',
        ok: true,
        markdown: this.buildMarkdownImage(state.document.uri, imageUri),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to select image.';
      this.postMessage(state, {
        type: 'insertImageResult',
        ok: false,
        error: message,
      });
    }
  }

  private buildMarkdownImage(documentUri: vscode.Uri, imageUri: vscode.Uri): string {
    const documentDirectory = path.posix.dirname(documentUri.path);
    const relativePath = path.posix.relative(documentDirectory, imageUri.path) || path.posix.basename(imageUri.path);
    const altText = path.posix.basename(imageUri.path, path.posix.extname(imageUri.path));
    const destination = /[\s()]/.test(relativePath) ? `<${relativePath}>` : relativePath;
    const escapedAltText = altText.replace(/[\\[\]]/g, '\\$&');
    return `![${escapedAltText}](${destination})`;
  }

  private getThemeKind(theme: vscode.ColorTheme): 'light' | 'dark' | 'hc' {
    switch (theme.kind) {
      case vscode.ColorThemeKind.Light:
        return 'light';
      case vscode.ColorThemeKind.HighContrast:
      case vscode.ColorThemeKind.HighContrastLight:
        return 'hc';
      default:
        return 'dark';
    }
  }
}
