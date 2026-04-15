import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { PanelState } from './panel-state';
import type { ResourceDescriptor } from './types';

const execFileAsync = promisify(execFile);
const DRAWIO_PREVIEW_UNAVAILABLE_MESSAGE = 'Install draw.io Desktop to preview draw.io files in MarkCanvas.';
const DRAWIO_PREVIEW_FAILED_MESSAGE = 'draw.io preview generation failed. Install draw.io Desktop and try again.';
const DRAWIO_PAGE_INDEX = 0;
const DRAWIO_OBSOLETE_PREVIEW_CLEANUP_DELAY_MS = 5000;

export class DrawioPreviewManager {
  private readonly activeDrawioPreviewRoots = new Set<string>();
  private drawioCliPathPromise: Promise<string | null> | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public register(state: PanelState): void {
    this.activeDrawioPreviewRoots.add(state.drawioPreviewRoot.toString());
    void this.cleanupInactiveEntries();
  }

  public dispose(state: PanelState): void {
    if (state.drawioCleanupTimer) {
      clearTimeout(state.drawioCleanupTimer);
      state.drawioCleanupTimer = null;
    }

    this.activeDrawioPreviewRoots.delete(state.drawioPreviewRoot.toString());
    void this.deletePreviewDirectory(state.drawioPreviewRoot);
  }

  public beginGeneration(state: PanelState): void {
    if (state.drawioPreviewDirectory) {
      state.obsoleteDrawioPreviewDirectories.push(state.drawioPreviewDirectory);
    }

    state.drawioPreviewGeneration += 1;
    state.drawioPreviewDirectory = vscode.Uri.joinPath(
      state.drawioPreviewRoot,
      String(state.drawioPreviewGeneration),
    );
    state.drawioPreviewOutputs = new Map();
  }

  public scheduleObsoletePreviewCleanup(state: PanelState): void {
    if (state.drawioCleanupTimer || state.obsoleteDrawioPreviewDirectories.length === 0) {
      return;
    }

    state.drawioCleanupTimer = setTimeout(() => {
      state.drawioCleanupTimer = null;
      const directories = state.obsoleteDrawioPreviewDirectories.splice(0);
      for (const directory of directories) {
        void this.deletePreviewDirectory(directory);
      }
    }, DRAWIO_OBSOLETE_PREVIEW_CLEANUP_DELAY_MS);
  }

  public async resolvePreviewResource(
    state: PanelState,
    original: string,
    suffix: string,
    targetUri: vscode.Uri,
  ): Promise<ResourceDescriptor> {
    const fallback: ResourceDescriptor = {
      original,
      resolved: null,
      exists: true,
      isDrawio: true,
      openTarget: targetUri.toString(),
      drawioPreviewStatus: 'unavailable',
      drawioPreviewMessage: DRAWIO_PREVIEW_UNAVAILABLE_MESSAGE,
    };

    if (targetUri.scheme !== 'file') {
      return fallback;
    }

    const cliPath = await this.findCliPath();
    if (!cliPath) {
      return fallback;
    }

    const previewDirectory = state.drawioPreviewDirectory;
    if (!previewDirectory) {
      return fallback;
    }

    const outputKey = `${targetUri.toString()}:${DRAWIO_PAGE_INDEX}`;
    const existingOutputUri = state.drawioPreviewOutputs.get(outputKey);
    if (existingOutputUri) {
      return {
        ...fallback,
        resolved: `${state.panel.webview.asWebviewUri(existingOutputUri).toString()}${suffix}`,
        drawioPreviewStatus: 'ready',
        drawioPreviewMessage: undefined,
      };
    }

    const outputName = `${createHash('sha256').update(outputKey).digest('hex')}.svg`;
    const outputUri = vscode.Uri.joinPath(previewDirectory, outputName);

    try {
      await vscode.workspace.fs.createDirectory(previewDirectory);
      await execFileAsync(
        cliPath,
        [
          '--export',
          '--format',
          'svg',
          '--page-index',
          String(DRAWIO_PAGE_INDEX),
          '--output',
          outputUri.fsPath,
          targetUri.fsPath,
        ],
        {
          timeout: 30000,
          windowsHide: true,
        },
      );
      await vscode.workspace.fs.stat(outputUri);
      state.drawioPreviewOutputs.set(outputKey, outputUri);

      return {
        ...fallback,
        resolved: `${state.panel.webview.asWebviewUri(outputUri).toString()}${suffix}`,
        drawioPreviewStatus: 'ready',
        drawioPreviewMessage: undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[markcanvas] draw.io preview generation failed: ${message}`);
      return {
        ...fallback,
        drawioPreviewStatus: 'failed',
        drawioPreviewMessage: DRAWIO_PREVIEW_FAILED_MESSAGE,
      };
    }
  }

  private async findCliPath(): Promise<string | null> {
    this.drawioCliPathPromise ??= this.resolveCliPath();
    return this.drawioCliPathPromise;
  }

  private async resolveCliPath(): Promise<string | null> {
    const candidates = this.getCliCandidates();
    for (const candidate of candidates) {
      if (await this.canExecuteCli(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private getCliCandidates(): string[] {
    const pathCandidates = ['drawio', 'draw.io', 'diagrams.net'];
    if (process.platform === 'darwin') {
      return [
        ...pathCandidates,
        '/Applications/draw.io.app/Contents/MacOS/draw.io',
        '/Applications/diagrams.net.app/Contents/MacOS/diagrams.net',
      ];
    }

    if (process.platform === 'win32') {
      return [
        ...pathCandidates,
        ...[
          process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'draw.io', 'draw.io.exe'),
          process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'draw.io', 'draw.io.exe'),
          process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'draw.io', 'draw.io.exe'),
          process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'diagrams.net', 'diagrams.net.exe'),
          process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'diagrams.net', 'diagrams.net.exe'),
          process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'diagrams.net', 'diagrams.net.exe'),
        ].filter((candidate): candidate is string => typeof candidate === 'string'),
      ];
    }

    return pathCandidates;
  }

  private async canExecuteCli(command: string): Promise<boolean> {
    try {
      await execFileAsync(command, ['--version'], {
        timeout: 10000,
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async cleanupInactiveEntries(): Promise<void> {
    const root = vscode.Uri.joinPath(this.context.globalStorageUri, 'drawio-preview');
    try {
      const entries = await vscode.workspace.fs.readDirectory(root);
      await Promise.all(entries.map(async ([name]) => {
        const entryUri = vscode.Uri.joinPath(root, name);
        if (this.activeDrawioPreviewRoots.has(entryUri.toString())) {
          return;
        }

        await this.deletePreviewDirectory(entryUri);
      }));
    } catch {
      // The preview root may not exist yet.
    }
  }

  private async deletePreviewDirectory(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.stat(uri);
      await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[markcanvas] failed to clean draw.io preview files: ${message}`);
    }
  }
}
