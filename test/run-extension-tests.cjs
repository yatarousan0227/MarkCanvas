const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.cjs');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      path.resolve(extensionDevelopmentPath),
      '--disable-extensions',
    ],
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
