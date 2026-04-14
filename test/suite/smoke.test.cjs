const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000;
  const intervalMs = options.intervalMs ?? 100;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await predicate();
    if (result) {
      return result;
    }

    await sleep(intervalMs);
  }

  throw new Error(options.message ?? 'Timed out while waiting for condition.');
}

suite('MarkCanvas smoke test', () => {
  test('opens the custom editor', async () => {
    const extension = vscode.extensions.getExtension('local.markcanvas');
    assert.ok(extension, 'Extension should be registered.');

    if (!extension.isActive) {
      await extension.activate();
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'Workspace folder should be available.');

    const documentUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, 'docs', 'manual-test.md'));

    await vscode.commands.executeCommand('vscode.openWith', documentUri, 'renderedMarkdown.editor');

    await waitFor(() => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const input = tab?.input;
      return input && typeof input === 'object' && input.viewType === 'renderedMarkdown.editor';
    }, {
      message: 'Custom editor tab did not become active.',
    });
  });
});
