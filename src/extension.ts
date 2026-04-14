import * as vscode from 'vscode';
import { RenderedMarkdownEditorProvider } from './provider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new RenderedMarkdownEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(RenderedMarkdownEditorProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('renderedMarkdown.openEditor', async (resource?: vscode.Uri) => {
      const target = resource ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        return;
      }

      await vscode.commands.executeCommand(
        'vscode.openWith',
        target,
        RenderedMarkdownEditorProvider.viewType,
      );
    }),
    vscode.commands.registerCommand('renderedMarkdown.openDrawioFile', async (resource?: vscode.Uri) => {
      if (!resource) {
        return;
      }

      await vscode.commands.executeCommand('vscode.open', resource);
    }),
  );
}

export function deactivate(): void {}
