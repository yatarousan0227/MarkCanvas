# MarkCanvas Serializer Regression Test

このファイルは MarkCanvas の serializer 周りの回帰確認専用です。

## How To Use

1. このワークスペースを VSCode で開く
2. `F5` で `Run MarkCanvas` を起動する
3. 開いた Extension Development Host 側でこのファイルを開く
4. `Open in MarkCanvas` を実行する
5. 開いただけで差分が出ないことを確認する
6. 軽く編集して保存し、未編集箇所の書式が壊れていないことを確認する

## Expected Invariants

- unordered list の marker が `-` のまま残る
- list item の間に不要な空行が入らない
- image alt text が `1.00` に化けない
- filename-like な文字列の `_` が不要に `\_` へ変わらない
- 通常文中の `draw.io` の `.` が不要に `\.` へ変わらない

## Tight Dash List

- one
- two
- three

## Ordered List

1. ordered one
2. ordered two
3. ordered three

## Filename-like Link Labels

This project follows [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

See also [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md).

## Dotted Prose

Detect linked draw.io SVG assets and jump back to the source diagram file.

MarkCanvas should leave docs.manual-test.md and sample.drawio.svg readable in prose.

This sentence intentionally mentions v1.2.3 and file.name.with.dots.md.

The release note references ver.2.10, api.v1.endpoint, and docs/manual-test.pdf in one sentence.

Use draw.io, mermaid.js, markdown-it, and sample.drawio.svg without adding escapes.

## Paths And Filenames

Open ../CODE_OF_CONDUCT.md, ../CONTRIBUTING.md, and ./fixtures/sample.drawio.svg when needed.

The config lives near .github/workflows/release.yml and docs/readme-hero-shot.md.

This paragraph mentions file_name.md, file-name.md, file.name.md, and file_name.with.many.parts.md.

Use app/config.dev.json, src/webview/index.ts, and package-lock.json as literal path-like text.

## Image Alt Text

![top hero image](../images/top.png)

![sample draw.io diagram](./fixtures/sample.drawio.svg)

![plain svg asset](./fixtures/plain.svg)

## Mixed Inline Text

Use `draw.io` with `CODE_OF_CONDUCT.md` and `sample.drawio.svg` in the same paragraph.

Do not rewrite `-` list markers, `draw.io`, or `CODE_OF_CONDUCT.md`.

Keep README.md, CHANGELOG.md, and package.json readable next to v1.2.3 and draw.io.

![plain](fixtures/plain.svg)

## Markdown-Adjacent Prose

This line contains brackets [like this], parentheses (like this), and file.name.md together.

This line mentions hash-like text #not-a-heading and greater-than text >not-a-quote inside prose.

This line contains stars and underscores in prose: foo_bar, foo-bar, and foo*bar should stay readable.

This line mixes slash, dot, and underscore: docs/serializer-regression.md and CODE_OF_CONDUCT.md.

This line mixes braces and brackets: foo_[bar].md, foo_{bar}.md, and file(name).md.

This line mixes punctuation-heavy versions: v1.2.3-beta, release/2026.04, and package@1.2.3.

## Line Start Cases

2026.04 release note should stay prose.

v1.2.3 starts this line and should not gain escaping.

draw.io starts this line and should remain unchanged.

CODE_OF_CONDUCT.md starts this line and should remain unchanged.

file.name.with.dots.md starts this line and should remain unchanged.

#not-a-heading starts this line and should stay prose.

>not-a-quote starts this line and should stay prose.

-literal starts this line and should stay prose if left untouched.

+literal starts this line and should stay prose if left untouched.

1.2.3 starts this line and should stay prose.

2) literal starts this line and should stay prose if possible.

__name__ starts this line and should be treated carefully.

## Nearby Markdown Syntax

- item with `inline_code`
- item with [README.md](../README.md)
- item with draw.io and CODE_OF_CONDUCT.md in plain text
- item with file.name.with.dots.md and v1.2.3 in plain text
- item with docs/manual-test.pdf and package-lock.json in plain text

> draw.io should stay readable in block quotes too.

> CODE_OF_CONDUCT.md and file.name.with.dots.md should stay readable in block quotes too.

Paragraph_with_underscores should still be treated carefully.

## Windows And Shell Paths

C:\Users\name\Documents\draw.io\file.drawio.svg should stay readable.

\\server\share\path\file_name.md should stay readable.

~/work/MarkCanvas/docs/serializer-regression.md should stay readable.

../relative/path/file_name.with.dots.md should stay readable.

## HTML-like And Entity-like Text

<draw.io> should stay readable if treated as plain prose.

<user@example.com> and <https://example.com/path/file_name.md> should be observed carefully.

AT&T, Fish & Chips, and A && B should stay readable.

Use &lt;div&gt;, &amp;, and foo;bar literally when they appear in prose.

## Backticks And Escapes

`draw.io` should stay as inline code.

This line mentions literal backticks like `code`, file_name.md, and draw.io together.

Keep a\b, a\\b, and C:\temp\file_name.md readable if possible.

## Long Mixed Paragraph

MarkCanvas should preserve prose that mentions draw.io, mermaid.js, CODE_OF_CONDUCT.md, docs/manual-test.md, src/webview/index.ts, package-lock.json, version v1.2.3, and file.name.with.dots.md all in one paragraph without injecting unnecessary escapes or changing list markers elsewhere in the file.
