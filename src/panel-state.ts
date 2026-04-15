import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';

export type PanelState = {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  applyingVersion: number | null;
  disposed: boolean;
  drawioPreviewRoot: vscode.Uri;
  drawioPreviewOutputs: Map<string, vscode.Uri>;
  documentSyncTimer: NodeJS.Timeout | null;
  pendingDocumentSyncOrigin: 'self' | 'external' | null;
  documentSyncInFlight: boolean;
};

export function createPanelState(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  document: vscode.TextDocument,
): PanelState {
  return {
    panel,
    document,
    applyingVersion: null,
    disposed: false,
    drawioPreviewRoot: vscode.Uri.joinPath(
      context.globalStorageUri,
      'drawio-preview',
      randomUUID(),
    ),
    drawioPreviewOutputs: new Map(),
    documentSyncTimer: null,
    pendingDocumentSyncOrigin: null,
    documentSyncInFlight: false,
  };
}
