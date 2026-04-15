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

    const sendDocument = async (
      type: 'initDocument' | 'replaceDocument',
      origin: 'self' | 'external' = 'external',
    ) => {
      if (state.disposed) {
        return;
      }
      const payload = await this.buildPayload(state);
      if (state.disposed) {
        return;
      }
      this.postMessage(state, { type, payload, origin });
      this.drawioPreviewManager.scheduleObsoletePreviewCleanup(state);
    };

    const documentSubscription = vscode.workspace.onDidChangeTextDocument(async (event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      if (state.applyingVersion === event.document.version) {
        state.applyingVersion = null;
        await sendDocument('replaceDocument', 'self');
        return;
      }

      await sendDocument('replaceDocument', 'external');
    });

    const themeSubscription = vscode.window.onDidChangeActiveColorTheme(() => {
      this.postMessage(state, {
        type: 'themeChanged',
        themeKind: this.getThemeKind(vscode.window.activeColorTheme),
      });
    });

    panel.onDidDispose(() => {
      state.disposed = true;
      this.drawioPreviewManager.dispose(state);
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

  private async buildPayload(state: PanelState): Promise<DocumentPayload> {
    this.drawioPreviewManager.beginGeneration(state);
    const resources = await this.resourceResolver.collectResources(state);

    return {
      uri: state.document.uri.toString(),
      version: state.document.version,
      markdown: state.document.getText(),
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
}
