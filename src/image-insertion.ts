import * as path from 'node:path';
import * as vscode from 'vscode';

const IMAGE_AND_DRAWIO_INSERTION_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'avif',
  'drawio',
  'dio',
  'xml',
];

export type ImageInsertionResult = {
  ok: boolean;
  cancelled?: boolean;
  markdown?: string;
  error?: string;
};

export async function promptForImageInsertion(documentUri: vscode.Uri): Promise<ImageInsertionResult> {
  try {
    const defaultUri = vscode.Uri.joinPath(documentUri, '..');
    const selection = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      defaultUri,
      filters: {
        'Images and draw.io Diagrams': IMAGE_AND_DRAWIO_INSERTION_EXTENSIONS,
      },
      openLabel: 'Insert Image',
    });

    const imageUri = selection?.[0];
    if (!imageUri) {
      return {
        ok: false,
        cancelled: true,
      };
    }

    return {
      ok: true,
      markdown: buildMarkdownImage(documentUri, imageUri),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to select image.',
    };
  }
}

function buildMarkdownImage(documentUri: vscode.Uri, imageUri: vscode.Uri): string {
  const documentDirectory = path.posix.dirname(documentUri.path);
  const relativePath = path.posix.relative(documentDirectory, imageUri.path) || path.posix.basename(imageUri.path);
  const altText = path.posix.basename(imageUri.path, path.posix.extname(imageUri.path));
  const destination = /[\s()]/.test(relativePath) ? `<${relativePath}>` : relativePath;
  const escapedAltText = altText.replace(/[\\[\]]/g, '\\$&');
  return `![${escapedAltText}](${destination})`;
}
