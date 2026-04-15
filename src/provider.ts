import * as vscode from 'vscode';
import { DrawioPreviewManager } from './drawio-preview-manager';
import { getWebviewHtml } from './html';
import { promptForImageInsertion } from './image-insertion';
import { createPanelState, type PanelState } from './panel-state';
import { ResourceResolver } from './resource-resolver';
import type {
  DocumentPayload,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from './types';

const DOCUMENT_SYNC_DEBOUNCE_MS = 120;
type PreviewTheme = 'system' | 'light' | 'dark';

export class RenderedMarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'renderedMarkdown.editor';

  private readonly drawioPreviewManager: DrawioPreviewManager;
  private readonly resourceResolver: ResourceResolver;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.drawioPreviewManager = new DrawioPreviewManager(context);
    this.resourceResolver = new ResourceResolver(this.drawioPreviewManager);
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const localResourceRoots = [
      this.context.extensionUri,
      this.context.globalStorageUri,
      ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []),
    ];
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots,
    };
    panel.webview.html = getWebviewHtml(panel.webview, this.context.extensionUri);

    const state = createPanelState(this.context, panel, document);
    this.drawioPreviewManager.register(state);

    const documentSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      if (state.applyingVersion === event.document.version) {
        state.applyingVersion = null;
        this.scheduleDocumentSync(state, 'self');
        return;
      }

      this.scheduleDocumentSync(state, 'external');
    });

    const themeSubscription = vscode.window.onDidChangeActiveColorTheme(() => {
      this.postMessage(state, {
        type: 'themeChanged',
        themeKind: this.getThemeKind(vscode.window.activeColorTheme),
      });
    });
    const previewThemeSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('markcanvas.previewTheme', document.uri)) {
        return;
      }

      this.postMessage(state, {
        type: 'previewThemeChanged',
        previewTheme: this.getConfiguredPreviewTheme(document.uri),
      });
    });

    panel.onDidDispose(() => {
      state.disposed = true;
      if (state.documentSyncTimer) {
        clearTimeout(state.documentSyncTimer);
        state.documentSyncTimer = null;
      }
      this.drawioPreviewManager.dispose(state);
      documentSubscription.dispose();
      themeSubscription.dispose();
      previewThemeSubscription.dispose();
    });

    panel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      switch (message.type) {
        case 'applyMarkdown':
          await this.applyMarkdown(state, message.markdown, message.version);
          return;
        case 'setPreviewTheme':
          await this.setConfiguredPreviewTheme(document.uri, message.previewTheme);
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

    await this.sendDocument(state, 'initDocument');
    this.postMessage(state, {
      type: 'themeChanged',
      themeKind: this.getThemeKind(vscode.window.activeColorTheme),
    });
    this.postMessage(state, {
      type: 'previewThemeChanged',
      previewTheme: this.getConfiguredPreviewTheme(document.uri),
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

  private scheduleDocumentSync(state: PanelState, origin: 'self' | 'external'): void {
    state.pendingDocumentSyncOrigin = state.pendingDocumentSyncOrigin === 'external' || origin === 'external'
      ? 'external'
      : origin;

    if (state.documentSyncInFlight || state.documentSyncTimer) {
      return;
    }

    state.documentSyncTimer = setTimeout(() => {
      state.documentSyncTimer = null;
      const pendingOrigin = state.pendingDocumentSyncOrigin ?? 'external';
      state.pendingDocumentSyncOrigin = null;
      void this.sendDocument(state, 'replaceDocument', pendingOrigin);
    }, DOCUMENT_SYNC_DEBOUNCE_MS);
  }

  private async sendDocument(
    state: PanelState,
    type: 'initDocument' | 'replaceDocument',
    origin: 'self' | 'external' = 'external',
  ): Promise<void> {
    if (state.disposed || state.documentSyncInFlight) {
      return;
    }

    state.documentSyncInFlight = true;
    const payload = await this.buildPayload(state);
    state.documentSyncInFlight = false;
    if (state.disposed) {
      return;
    }

    if (state.document.version !== payload.version) {
      this.scheduleDocumentSync(state, 'external');
      return;
    }

    this.postMessage(state, { type, payload, origin });

    if (state.pendingDocumentSyncOrigin) {
      this.scheduleDocumentSync(state, state.pendingDocumentSyncOrigin);
    }
  }

  private async buildPayload(state: PanelState): Promise<DocumentPayload> {
    const version = state.document.version;
    const markdown = state.document.getText();
    const resources = await this.resourceResolver.collectResources(state, markdown);

    return {
      uri: state.document.uri.toString(),
      version,
      markdown,
      resources,
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
    const result = await promptForImageInsertion(state.document.uri);
    this.postMessage(state, {
      type: 'insertImageResult',
      ...result,
    });
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

  private getConfiguredPreviewTheme(resource: vscode.Uri): PreviewTheme {
    const value = vscode.workspace
      .getConfiguration('markcanvas', resource)
      .get<string>('previewTheme');
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  }

  private async setConfiguredPreviewTheme(resource: vscode.Uri, previewTheme: PreviewTheme): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('markcanvas', resource);
    const inspected = configuration.inspect<PreviewTheme>('previewTheme');
    let target = vscode.ConfigurationTarget.Global;

    if (inspected?.workspaceFolderValue !== undefined) {
      target = vscode.ConfigurationTarget.WorkspaceFolder;
    } else if (inspected?.workspaceValue !== undefined) {
      target = vscode.ConfigurationTarget.Workspace;
    }

    await configuration.update('previewTheme', previewTheme, target);
  }
}
