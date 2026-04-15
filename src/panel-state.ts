import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { ResourceDescriptor } from './types';

export type ResourceResolutionCacheEntry = {
  cacheKey: string;
  descriptor: ResourceDescriptor;
};

export type PanelState = {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  applyingVersion: number | null;
  disposed: boolean;
  drawioPreviewRoot: vscode.Uri;
  drawioPreviewOutputs: Map<string, vscode.Uri>;
  resourceResolutionCache: Map<string, ResourceResolutionCacheEntry>;
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
    resourceResolutionCache: new Map(),
    documentSyncTimer: null,
    pendingDocumentSyncOrigin: null,
    documentSyncInFlight: false,
  };
}
