import * as path from 'node:path';
import * as vscode from 'vscode';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import { DrawioPreviewManager } from './drawio-preview-manager';
import { PanelState } from './panel-state';
import type { ResourceDescriptor } from './types';

const COMMON_BINARY_IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.webp']);

export class ResourceResolver {
  constructor(private readonly drawioPreviewManager: DrawioPreviewManager) {}

  public async collectResources(state: PanelState, markdown: string): Promise<ResourceDescriptor[]> {
    const tree = unified().use(remarkParse).parse(markdown);
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

      urls.push(...extractHtmlResourceUrls(node.value));
    });

    for (const original of urls) {
      if (seen.has(original)) {
        continue;
      }
      seen.add(original);

      resources.push(await this.resolveResource(state, original));
    }

    return resources;
  }

  private async resolveResource(
    state: PanelState,
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

    const [resourcePath, suffix] = splitResourceReference(original);
    const targetUri = resolveWorkspaceUri(state.document.uri, resourcePath);
    if (!targetUri) {
      return missingResource(original);
    }

    try {
      const stat = await vscode.workspace.fs.stat(targetUri);
      if (stat.type !== vscode.FileType.File) {
        return missingResource(original);
      }

      const lowerPath = targetUri.path.toLowerCase();
      const isSvg = lowerPath.endsWith('.svg');
      const isDrawioSourceFile = lowerPath.endsWith('.drawio') || lowerPath.endsWith('.dio');
      const isNamedDrawioImage = lowerPath.endsWith('.drawio.svg') || lowerPath.endsWith('.drawio.png');
      const isXml = lowerPath.endsWith('.xml');
      const extension = path.posix.extname(lowerPath);
      const shouldReadForDrawioDetection = isSvg
        || isDrawioSourceFile
        || isXml
        || (!COMMON_BINARY_IMAGE_EXTENSIONS.has(extension) && stat.size <= 1024 * 1024);
      const fileBytes = shouldReadForDrawioDetection ? await vscode.workspace.fs.readFile(targetUri) : undefined;
      const fileContent = fileBytes ? Buffer.from(fileBytes).toString('utf8') : '';
      const isDrawioImage = isNamedDrawioImage
        || fileContent.includes('content="&lt;mxfile')
        || fileContent.includes('data-mxgraph=');
      const isDrawioXml = isDrawioSourceFile || fileContent.includes('<mxfile');
      const isDrawio = isDrawioImage || isDrawioXml;

      if (isDrawioXml && !isSvg) {
        return this.drawioPreviewManager.resolvePreviewResource(
          state,
          original,
          suffix,
          targetUri,
          stat,
        );
      }

      return {
        original,
        resolved: `${state.panel.webview.asWebviewUri(targetUri).toString()}${suffix}`,
        exists: true,
        isDrawio,
        openTarget: isDrawio ? targetUri.toString() : null,
        drawioPreviewStatus: isDrawio ? 'ready' : undefined,
      };
    } catch {
      return missingResource(original);
    }
  }
}

function extractHtmlResourceUrls(html: string): string[] {
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

function splitResourceReference(raw: string): [string, string] {
  const hashIndex = raw.indexOf('#');
  const queryIndex = raw.indexOf('?');
  const cutIndex = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .reduce((min, index) => Math.min(min, index), raw.length);

  return [raw.slice(0, cutIndex), raw.slice(cutIndex)];
}

function resolveWorkspaceUri(documentUri: vscode.Uri, raw: string): vscode.Uri | null {
  if (/^[a-z]+:/i.test(raw)) {
    return null;
  }

  if (raw.startsWith('/')) {
    return vscode.Uri.file(raw);
  }

  const documentDirectory = path.posix.dirname(documentUri.path);
  return vscode.Uri.joinPath(documentUri.with({ path: documentDirectory }), raw);
}

function missingResource(original: string): ResourceDescriptor {
  return {
    original,
    resolved: null,
    exists: false,
    isDrawio: false,
    openTarget: null,
  };
}
