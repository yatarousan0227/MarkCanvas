const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { unified } = require('unified');
const remarkParse = require('remark-parse').default;
const esbuild = require('esbuild');

let milkdownCore;
let commonmarkPreset;
let gfmPreset;
let milkdownUtils;
let tableWidths;
const fallbackEventTarget = new EventTarget();

const DOM_GLOBAL_KEYS = [
  'window',
  'Window',
  'document',
  'navigator',
  'Node',
  'Text',
  'Element',
  'HTMLElement',
  'SVGElement',
  'DocumentFragment',
  'MutationObserver',
  'DOMParser',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'InputEvent',
  'Range',
  'Selection',
  'getSelection',
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'innerHeight',
  'innerWidth',
  'matchMedia',
  'ResizeObserver',
];

function createEmptyRect() {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
    toJSON() {
      return this;
    },
  };
}

function createEmptyRectList() {
  return {
    length: 0,
    item() {
      return null;
    },
    [Symbol.iterator]: function* iterator() {},
  };
}

function getLineOffsets(markdown) {
  const offsets = [0];

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === '\n') {
      offsets.push(index + 1);
    }
  }

  return offsets;
}

function getOffset(point, markdown, lineOffsets, fallback) {
  if (typeof point?.offset === 'number') {
    return point.offset;
  }

  if (typeof point?.line === 'number' && typeof point.column === 'number') {
    const lineStart = lineOffsets[point.line - 1];
    if (typeof lineStart === 'number') {
      return lineStart + point.column - 1;
    }
  }

  return Math.min(Math.max(fallback, 0), markdown.length);
}

function normalizeNode(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeNode(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (key === 'children' || key === 'data' || key === 'position' || key === 'spread') {
      continue;
    }

    normalized[key] = normalizeNode(value[key]);
  }

  if (Array.isArray(value.children)) {
    normalized.children = value.children.map((child) => normalizeNode(child));
  }

  return normalized;
}

function createMarkdownSnapshot(markdown) {
  const root = unified().use(remarkParse).parse(markdown);
  const children = Array.isArray(root.children) ? root.children : [];

  if (children.length === 0) {
    return {
      blocks: [],
      leading: markdown,
      markdown,
    };
  }

  const lineOffsets = getLineOffsets(markdown);
  const blocks = children.map((node, index) => {
    const start = getOffset(node.position?.start, markdown, lineOffsets, 0);
    const end = getOffset(node.position?.end, markdown, lineOffsets, start);
    const next = children[index + 1];
    const nextStart = next
      ? getOffset(next.position?.start, markdown, lineOffsets, end)
      : markdown.length;

    return {
      fingerprint: JSON.stringify(normalizeNode(node)),
      source: markdown.slice(start, end),
      trailing: markdown.slice(end, nextStart),
    };
  });

  return {
    blocks,
    leading: markdown.slice(0, getOffset(children[0]?.position?.start, markdown, lineOffsets, 0)),
    markdown,
  };
}

function getBlockMatches(baseline, current) {
  const rows = baseline.length;
  const cols = current.length;
  const dp = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      if (baseline[row] === current[col]) {
        dp[row][col] = dp[row + 1][col + 1] + 1;
      } else {
        dp[row][col] = Math.max(dp[row + 1][col], dp[row][col + 1]);
      }
    }
  }

  const matches = Array(cols).fill(-1);
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (baseline[row] === current[col]) {
      matches[col] = row;
      row += 1;
      col += 1;
      continue;
    }

    if (dp[row + 1][col] >= dp[row][col + 1]) {
      row += 1;
    } else {
      col += 1;
    }
  }

  return matches;
}

function reconcileMarkdown(originalMarkdown, currentMarkdown) {
  const baseline = createMarkdownSnapshot(originalMarkdown);
  const current = createMarkdownSnapshot(currentMarkdown);

  if (current.blocks.length === 0) {
    return current.markdown;
  }

  const matches = getBlockMatches(
    baseline.blocks.map((block) => block.fingerprint),
    current.blocks.map((block) => block.fingerprint),
  );

  if (
    baseline.blocks.length === current.blocks.length
    && matches.every((baselineIndex, currentIndex) => baselineIndex === currentIndex)
  ) {
    return baseline.markdown;
  }

  let result = baseline.leading;
  for (let index = 0; index < current.blocks.length; index += 1) {
    const baselineIndex = matches[index];
    const baselineBlock = baselineIndex >= 0 ? baseline.blocks[baselineIndex] : null;
    const currentBlock = current.blocks[index];

    result += baselineBlock?.source ?? currentBlock.source;

    if (index === current.blocks.length - 1) {
      result += baselineIndex === baseline.blocks.length - 1
        ? baselineBlock?.trailing ?? ''
        : currentBlock.trailing;
      continue;
    }

    const nextBaselineIndex = matches[index + 1];
    result += baselineIndex >= 0 && nextBaselineIndex === baselineIndex + 1
      ? baseline.blocks[baselineIndex].trailing
      : '\n\n';
  }

  return result;
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const { window } = dom;
  const previousValues = new Map();

  for (const key of DOM_GLOBAL_KEYS) {
    previousValues.set(key, globalThis[key]);
  }

  window.Range.prototype.getClientRects = () => createEmptyRectList();
  window.Range.prototype.getBoundingClientRect = () => createEmptyRect();
  window.HTMLElement.prototype.getClientRects = () => createEmptyRectList();
  window.HTMLElement.prototype.getBoundingClientRect = () => createEmptyRect();
  window.Element.prototype.getClientRects = () => createEmptyRectList();
  window.Element.prototype.getBoundingClientRect = () => createEmptyRect();
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.document.elementFromPoint = () => null;
  window.document.caretRangeFromPoint = () => null;
  window.document.caretPositionFromPoint = () => null;

  const assignments = {
    window,
    Window: window.Window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    Text: window.Text,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
    DocumentFragment: window.DocumentFragment,
    MutationObserver: window.MutationObserver,
    DOMParser: window.DOMParser,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    InputEvent: window.InputEvent,
    Range: window.Range,
    Selection: window.Selection,
    getSelection: window.getSelection.bind(window),
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    dispatchEvent: window.dispatchEvent.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    getComputedStyle: window.getComputedStyle.bind(window),
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    matchMedia: window.matchMedia
      ? window.matchMedia.bind(window)
      : () => ({
          matches: false,
          media: '',
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {
            return false;
          },
        }),
    ResizeObserver: globalThis.ResizeObserver
      ?? class ResizeObserver {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
  };

  Object.assign(globalThis, assignments);

  return {
    restore() {
      for (const key of DOM_GLOBAL_KEYS) {
        const previousValue = previousValues.get(key);
        if (previousValue === undefined) {
          if (key === 'addEventListener') {
            globalThis[key] = fallbackEventTarget.addEventListener.bind(fallbackEventTarget);
            continue;
          }
          if (key === 'removeEventListener') {
            globalThis[key] = fallbackEventTarget.removeEventListener.bind(fallbackEventTarget);
            continue;
          }
          if (key === 'dispatchEvent') {
            globalThis[key] = fallbackEventTarget.dispatchEvent.bind(fallbackEventTarget);
            continue;
          }
          delete globalThis[key];
          continue;
        }

        globalThis[key] = previousValue;
      }

      window.close();
    },
  };
}

async function roundTripMarkdown(markdown) {
  const dom = installDom();
  let editor;

  try {
    document.body.innerHTML = '<div id="root"></div>';

    const { Editor, rootCtx, defaultValueCtx } = milkdownCore;
    const { commonmark } = commonmarkPreset;
    const { gfm } = gfmPreset;
    const { getMarkdown } = milkdownUtils;

    editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, document.querySelector('#root'));
        ctx.set(defaultValueCtx, markdown);
      })
      .use(commonmark)
      .use(gfm);

    await editor.create();
    return editor.action(getMarkdown());
  } finally {
    if (editor) {
      await editor.destroy();
    }
    dom.restore();
  }
}

async function roundTripMathMarkdown(markdown) {
  const dom = installDom();
  let crepe;

  try {
    document.body.innerHTML = '<div id="app"></div>';

    const { Crepe } = await import('@milkdown/crepe');

    crepe = new Crepe({
      root: '#app',
      defaultValue: markdown,
      features: {
        [Crepe.Feature.Latex]: true,
        [Crepe.Feature.TopBar]: false,
      },
    });

    await crepe.create();
    return crepe.getMarkdown();
  } finally {
    if (crepe) {
      await crepe.destroy();
    }
    dom.restore();
  }
}

async function roundTripMarkCanvasMarkdown(markdown) {
  const dom = installDom();
  let crepe;

  try {
    document.body.innerHTML = '<div id="app"></div>';

    const { Crepe } = await import('@milkdown/crepe');
    const { remarkStringifyOptionsCtx } = milkdownCore;

    crepe = new Crepe({
      root: '#app',
      defaultValue: markdown,
      features: {
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.Latex]: true,
        [Crepe.Feature.TopBar]: false,
      },
    });

    crepe.editor.config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (value) => ({
        ...value,
        bullet: '-',
        join: [
          (left, right, parent) => {
            if (parent && (parent.type === 'list' || parent.type === 'listItem')) {
              return 0;
            }

            return undefined;
          },
        ],
        handlers: {
          ...value.handlers,
          text: (node, _, state, info) => {
            const text = typeof node.value === 'string' ? node.value : '';
            if (/^[A-Za-z0-9][A-Za-z0-9./_-]*$/.test(text) || /^[^*_\\]*\s+$/.test(text)) {
              return text;
            }

            return state.safe(text, {
              ...info,
              encode: [],
            })
              .replace(/\\\./g, '.')
              .replace(/([A-Za-z0-9./-])\\_([A-Za-z0-9./-])/g, '$1_$2')
              .replace(/([A-Za-z0-9])\\\*([A-Za-z0-9])/g, '$1*$2')
              .replace(/\\\[([^[\]\r\n]+)](?!\(|\[)/g, '[$1]');
          },
        },
      }));
    });

    await crepe.create();
    return crepe.getMarkdown();
  } finally {
    if (crepe) {
      await crepe.destroy();
    }
    dom.restore();
  }
}

async function importTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const transformed = await esbuild.transform(source, {
    loader: 'ts',
    format: 'esm',
    target: 'node20',
  });
  const encoded = Buffer.from(transformed.code).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}

suite('MarkCanvas markdown round-trip', () => {
  suiteSetup(async () => {
    [milkdownCore, commonmarkPreset, gfmPreset, milkdownUtils, tableWidths] = await Promise.all([
      import('@milkdown/kit/core'),
      import('@milkdown/kit/preset/commonmark'),
      import('@milkdown/kit/preset/gfm'),
      import('@milkdown/utils'),
      importTypeScriptModule(path.join(__dirname, '..', '..', 'src', 'webview', 'table-widths.ts')),
    ]);
  });

  test('extracts table width units and alignment from delimiter rows', () => {
    const ranges = tableWidths.extractTableWidthRanges([
      '|  name | value |',
      '| :---: | ----- |',
      '| alpha | 1     |',
      '|  beta | 2     |',
      '',
    ].join('\n'));

    assert.equal(ranges.length, 1);
    assert.deepEqual(ranges[0].spec.columnUnits, [3, 5]);
    assert.deepEqual(ranges[0].spec.aligns, ['center', null]);
  });

  test('applies table width state by rewriting only the delimiter row', () => {
    const markdown = [
      '| name  | value |',
      '| ----- | ----- |',
      '| alpha | 1     |',
      '| beta  | 2     |',
      '',
    ].join('\n');
    const state = tableWidths.createTableWidthState(markdown);
    tableWidths.setTableWidthSpec(state, 0, [9, 3]);

    const result = tableWidths.applyTableWidthState(markdown, state);

    assert.equal(result, [
      '| name  | value |',
      '| --------- | --- |',
      '| alpha | 1     |',
      '| beta  | 2     |',
      '',
    ].join('\n'));
  });

  test('ignores table-like delimiter rows inside fenced code blocks', () => {
    const markdown = [
      '```md',
      '| name | value |',
      '| ---- | ----- |',
      '| code | 1     |',
      '```',
      '',
      '| name | value |',
      '| ---- | ----- |',
      '| doc  | 2     |',
      '',
    ].join('\n');

    const ranges = tableWidths.extractTableWidthRanges(markdown);

    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].delimiterLine, 7);
  });

  test('preserves current table alignment while applying stored widths', () => {
    const markdown = [
      '| name | value | count |',
      '| ---- | -----: | :---: |',
      '| a    | 1      | 2     |',
      '',
    ].join('\n');
    const state = tableWidths.createTableWidthState(markdown);
    tableWidths.setTableWidthSpec(state, 0, [3, 8, 5]);

    const result = tableWidths.applyTableWidthState(markdown, state);

    assert.equal(result.split('\n')[1], '| --- | --------: | :-----: |');
  });

  test('normalizes table width specs when columns are added', () => {
    const markdown = [
      '| name | value | extra |',
      '| ---- | ----- | ----- |',
      '| a    | 1     | x     |',
      '',
    ].join('\n');
    const state = {
      specs: [{ columnUnits: [8, 4], aligns: [null, null] }],
      dirtyTableIndexes: new Set([0]),
    };

    const result = tableWidths.applyTableWidthState(markdown, state);

    assert.equal(result.split('\n')[1], '| -------- | ---- | ------ |');
  });

  test('updates table width specs for explicit column insertion and deletion', () => {
    const state = {
      specs: [{ columnUnits: [8, 4, 10], aligns: [null, 'right', 'center'] }],
      dirtyTableIndexes: new Set(),
    };

    tableWidths.insertTableWidthColumn(state, 0, 1, 3);
    assert.deepEqual(state.specs[0].columnUnits, [8, 6, 4, 10]);
    assert.deepEqual(state.specs[0].aligns, [null, null, 'right', 'center']);

    tableWidths.deleteTableWidthColumn(state, 0, 2, 4);
    assert.deepEqual(state.specs[0].columnUnits, [8, 6, 10]);
    assert.deepEqual(state.specs[0].aligns, [null, null, 'center']);
  });

  test('converts pixel widths to bounded ratio markdown width units', () => {
    assert.deepEqual(tableWidths.normalizeColumnUnitsFromWidths([100, 100]), [3, 3]);
    assert.deepEqual(tableWidths.normalizeColumnUnitsFromWidths([50, 100]), [3, 6]);
    assert.deepEqual(tableWidths.normalizeColumnUnitsFromWidths([36, 144, 288]), [3, 11, 22]);
  });

  test('preserves canonical commonmark and gfm markdown', async () => {
    const markdown = [
      '# Heading',
      '',
      '1. ordered one',
      '2. ordered two',
      '',
      '> quote block',
      '',
      '`inline code` and ~~strikethrough~~',
      '',
      '```ts',
      'console.log("hello")',
      '```',
      '',
      '| name  | value |',
      '| ----- | ----- |',
      '| alpha | 1     |',
      '| beta  | 2     |',
      '',
      '[OpenAI](https://openai.com/)',
      '',
    ].join('\n');

    const result = await roundTripMarkdown(markdown);
    assert.equal(result, markdown);
  });

  test('preserves raw html blocks', async () => {
    const markdown = [
      '> <p>Hello, world!</p>',
      '',
      '<div data-kind="callout">',
      '  <strong>HTML block</strong>',
      '</div>',
      '',
    ].join('\n');

    const result = await roundTripMarkdown(markdown);
    assert.equal(result, markdown);
  });

  test('preserves fenced blocks with pseudocode info strings', async () => {
    const markdown = [
      '```pseudocode',
      'if user.isReady',
      '  display "done"',
      'end',
      '```',
      '',
    ].join('\n');

    const result = await roundTripMarkdown(markdown);
    assert.equal(result, markdown);
  });

  test('preserves inline and block math when latex is enabled', async function testMathRoundTrip() {
    this.timeout(10000);

    const markdown = [
      'Inline math: $E = mc^2$',
      '',
      '$$',
      '\\int_0^1 x^2 \\, dx',
      '$$',
      '',
    ].join('\n');

    const result = await roundTripMathMarkdown(markdown);
    assert.equal(result, markdown);
  });

  test('preserves image alt text in MarkCanvas config', async function testImageAltRoundTrip() {
    this.timeout(10000);

    const markdown = [
      '![alt text](images/top.png)',
      '',
    ].join('\n');

    const result = await roundTripMarkCanvasMarkdown(markdown);
    assert.equal(result, markdown);
  });

  test('preserves filename-like link labels without escaping underscores', async function testLinkLabelRoundTrip() {
    this.timeout(10000);

    const markdown = [
      'This project follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).',
      '',
    ].join('\n');

    const result = await roundTripMarkCanvasMarkdown(markdown);
    assert.equal(result, markdown);
  });

  test('preserves tight dash bullet lists in MarkCanvas config', async function testListRoundTrip() {
    this.timeout(10000);

    const markdown = [
      '- one',
      '- two',
      '',
    ].join('\n');

    const result = await roundTripMarkCanvasMarkdown(markdown);
    assert.equal(result, markdown);
  });

  test('preserves task list checkbox states in MarkCanvas config', async function testTaskListRoundTrip() {
    this.timeout(10000);

    const markdown = [
      '- [x] shipped',
      '- [ ] pending',
      '',
    ].join('\n');

    const result = await roundTripMarkCanvasMarkdown(markdown);
    assert.equal(result, markdown);
  });

  test('preserves dotted prose without escaping periods', async function testDottedProseRoundTrip() {
    this.timeout(10000);

    const markdown = [
      'Detect linked draw.io SVG assets and jump back to the source diagram file',
      '',
    ].join('\n');

    const result = await roundTripMarkCanvasMarkdown(markdown);
    assert.equal(result, markdown);
  });

  test('preserves path-like underscores without escaping', async function testUnderscoreRoundTrip() {
    this.timeout(10000);

    const markdown = [
      'Open ../CODE_OF_CONDUCT.md, ../CONTRIBUTING.md, and ./fixtures/sample.drawio.svg when needed.',
      '',
    ].join('\n');

    const result = await roundTripMarkCanvasMarkdown(markdown);
    assert.equal(result, markdown);
  });

  test('preserves bracketed prose and intraword stars', async function testBracketedProseRoundTrip() {
    this.timeout(10000);

    const markdown = [
      'This line contains brackets [like this], parentheses (like this), and file.name.md together.',
      'This line contains stars and underscores in prose: foo_bar, foo-bar, and foo*bar should stay readable.',
      '',
    ].join('\n');

    const result = await roundTripMarkCanvasMarkdown(markdown);
    assert.equal(result, markdown);
  });

  test('source-preserving save keeps the regression fixture byte-exact when untouched', async function testSourcePreservingFixture() {
    this.timeout(10000);

    const markdown = fs.readFileSync(
      path.join(__dirname, '..', '..', 'docs', 'serializer-regression.md'),
      'utf8',
    );

    const canonical = await roundTripMarkCanvasMarkdown(markdown);
    const result = reconcileMarkdown(markdown, canonical);
    assert.equal(result, markdown);
  });

  test('source-preserving save only rewrites the edited paragraph block', async function testSourcePreservingParagraphEdit() {
    this.timeout(10000);

    const originalMarkdown = [
      '# Sample',
      '',
      'Detect linked draw.io SVG assets and jump back to the source diagram file.',
      '',
      'Open ../CODE_OF_CONDUCT.md, ../CONTRIBUTING.md, and ./fixtures/sample.drawio.svg when needed.',
      '',
      '- one',
      '- two',
      '',
    ].join('\n');
    const editedMarkdown = [
      '# Sample',
      '',
      'Detect linked draw.io and Mermaid assets and jump back to the source diagram file.',
      '',
      'Open ../CODE_OF_CONDUCT.md, ../CONTRIBUTING.md, and ./fixtures/sample.drawio.svg when needed.',
      '',
      '- one',
      '- two',
      '',
    ].join('\n');

    const canonical = await roundTripMarkCanvasMarkdown(editedMarkdown);
    const result = reconcileMarkdown(originalMarkdown, canonical);
    assert.equal(result, editedMarkdown);
  });

  test('source-preserving save keeps dash markers and tight lists when the list block changes', async function testSourcePreservingListEdit() {
    this.timeout(10000);

    const originalMarkdown = [
      'This project follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).',
      '',
      '- one',
      '- two',
      '',
      'Detect linked draw.io SVG assets and jump back to the source diagram file.',
      '',
    ].join('\n');
    const editedMarkdown = [
      'This project follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).',
      '',
      '- one',
      '- two updated',
      '',
      'Detect linked draw.io SVG assets and jump back to the source diagram file.',
      '',
    ].join('\n');

    const canonical = await roundTripMarkCanvasMarkdown(editedMarkdown);
    const result = reconcileMarkdown(originalMarkdown, canonical);
    assert.equal(result, editedMarkdown);
  });
});
