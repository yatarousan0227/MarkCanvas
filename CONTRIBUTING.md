# Contributing to MarkCanvas

Thanks for contributing to MarkCanvas.
This document describes the expected workflow for issues, pull requests, and local development.

## Language

Issues and pull requests may be written in English or Japanese.
When possible, keep titles and reproduction steps concrete so other contributors can follow them quickly.

## Before You Start

* Check whether the bug or feature request already exists.

* Keep pull requests focused on one change set whenever possible.

* For non-trivial features or behavior changes, open an issue first so the scope can be aligned before implementation.

## Local Setup

```bash
npm install
npm run build
```

Open the repository in VS Code and press `F5` to launch the Extension Development Host.

## Development Workflow

1. Create a branch for your work.
2. Make the smallest change that solves the problem cleanly.
3. Run the relevant validation steps.
4. Update documentation when behavior, commands, or setup steps change.
5. Open a pull request with a clear summary and validation notes.

## Validation

Run these commands before opening a pull request when they apply:

```bash
npm run build
npm run typecheck
npm run test:extension
```

For UI and editor behavior changes, also verify the manual scenario in [docs/manual-test.md](docs/manual-test.md) using the Extension Development Host.

## Implementation Notes

* Preserve the Markdown file as the canonical source of truth.

* Keep extension-to-webview and webview-to-extension message contracts explicit and backward compatible within the PR.

* Prefer small, readable TypeScript changes over broad refactors unless the refactor is the point of the PR.

* If you change user-facing behavior, document the reasoning and expected outcomes in the pull request description.

## Pull Request Checklist

Please include the following in your pull request:

* A short summary of the problem and the change

* Screenshots or recordings for UI changes when useful

* Test steps you ran, including any manual verification

* Notes about follow-up work or known limitations, if any

## Reporting Bugs

When opening a bug report, include:

* VS Code version

* Operating system

* Steps to reproduce

* Expected result

* Actual result

* Sample Markdown or asset files when the issue depends on document content

## Security Issues

Do not report security-sensitive issues in a public bug report.
Follow the process in [SECURITY.md](SECURITY.md).

## License

By contributing to this repository, you agree that your contributions will be licensed under the [MIT License](LICENSE).
