const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let milkdownCore;
let commonmarkPreset;
let gfmPreset;
let milkdownUtils;
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

suite('MarkCanvas markdown round-trip', () => {
  suiteSetup(async () => {
    [milkdownCore, commonmarkPreset, gfmPreset, milkdownUtils] = await Promise.all([
      import('@milkdown/kit/core'),
      import('@milkdown/kit/preset/commonmark'),
      import('@milkdown/kit/preset/gfm'),
      import('@milkdown/utils'),
    ]);
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
});
