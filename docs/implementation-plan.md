# MarkCanvas Implementation Plan

## Summary

* 目標は、Milkdown ベースの VSCode カスタムエディタ拡張を実装すること。

* エディタ形態は `CustomTextEditorProvider` を使う単一 WYSIWYG 編集に固定し、Markdown のソースを唯一の正本として扱う。

* 初期スコープは 3 本柱:

  1. Milkdown で Markdown をレンダリング状態のまま編集
  2. `mermaid` コードフェンスの表示
  3. Markdown から参照された `*.drawio.svg` / draw\.io メタデータ付き SVG の表示と、そのファイルを開く導線

## Key Changes

* 拡張の基本構成を TypeScript で作る。主要責務は次の 3 つに分離する。

  * `package.json`: `*.md` 向け custom editor、`Open in MarkCanvas` コマンド、`onCustomEditor` activation を定義

  * `src/provider.ts`: `CustomTextEditorProvider` 登録、webview 初期化、`TextDocument` と webview 間の同期、`vscode.open` による draw\.io ファイル遷移

  * `src/webview/*`: Milkdown アプリ本体、メッセージブリッジ、Mermaid/Draw\.io 用のカスタム表示ロジック

* Webview 側は Milkdown 構成を使い、CommonMark + GFM + history + clipboard + listener を有効化する。UI は VSCode テーマトークンに寄せ、外観だけ独自 CSS で整える。

* 文書同期は「webview 編集 -> debounce -> Markdown 文字列送信 -> extension が `WorkspaceEdit` 適用」「外部変更/undo/redo -> extension から全文再送」の双方向同期にする。差分ループ防止のため、document version と origin フラグで再入を抑制する。

* Mermaid は Markdown の \`\`\`mermaid フェンスを SVG プレビューとして表示する。

* Mermaid エラー時はレンダリングを壊さず、エラーバナーを表示する。

* Draw.io は Markdown 内の画像リンクまたは参照先ファイルを解析し、拡張子が `.drawio.svg` もしくは SVG 内に draw.io 埋め込み XML がある場合だけ専用カードとして表示する。カードには `Open Diagram File` アクションを持たせ、参照中の SVG ファイルを VSCode で開く。該当しない通常 SVG は通常画像として扱う。

## Public Interfaces

* custom editor view type: `renderedMarkdown.editor`

* commands:

  * `renderedMarkdown.openEditor`

  * `renderedMarkdown.openDrawioFile`

* extension -> webview:

  * `initDocument`

  * `replaceDocument`

  * `themeChanged`

  * `openResourceResult`

* webview -> extension:

  * `applyMarkdown`

  * `openDrawioFile`

  * `reportRenderError`

## Test Plan

* Markdown 基本編集: 見出し、リスト、表、画像、リンクが WYSIWYG 上で編集でき、保存後も Markdown が崩れない。

* 同期: 外部テキスト編集、undo/redo、revert、split editor で webview 表示が追従する。

* Mermaid 正常系: 複数種の `mermaid` フェンスが描画される。

* Mermaid 異常系: 不正構文でもエディタ全体は壊れず、エラー表示が残る。

* Draw.io: `.drawio.svg` が表示され、アクションから対象 SVG ファイルを開ける。

* Fallback: 通常 SVG、存在しない画像、外部 URL 画像は安全に通常表示またはエラー表示へ落ちる。

## Assumptions

* 対応対象は desktop VS Code のみ。web extension 化は初版スコープ外。

* Markdown の canonical form は常にテキストファイル本体で、独自 AST や別メタファイルは持たない。

* Draw\.io の「そのファイルに遷移」は Markdown が参照している SVG ファイルを VSCode で開く動作を指す。

