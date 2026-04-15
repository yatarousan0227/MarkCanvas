import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';

export type PanelState = {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  applyingVersion: number | null;
  disposed: boolean;
  drawioPreviewRoot: vscode.Uri;
  drawioPreviewDirectory: vscode.Uri | null;
  drawioPreviewGeneration: number;
  drawioPreviewOutputs: Map<string, vscode.Uri>;
  obsoleteDrawioPreviewDirectories: vscode.Uri[];
  drawioCleanupTimer: NodeJS.Timeout | null;
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
    drawioPreviewDirectory: null,
    drawioPreviewGeneration: 0,
    drawioPreviewOutputs: new Map(),
    obsoleteDrawioPreviewDirectories: [],
    drawioCleanupTimer: null,
  };
}
