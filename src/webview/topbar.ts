import type { Ctx } from '@milkdown/kit/ctx';
import { imageBlockSchema } from '@milkdown/kit/component/image-block';
import { toggleLinkCommand } from '@milkdown/kit/component/link-tooltip';
import { commandsCtx, editorViewCtx, parserCtx } from '@milkdown/kit/core';
import {
  addBlockTypeCommand,
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  emphasisSchema,
  headingSchema,
  hrSchema,
  inlineCodeSchema,
  isMarkSelectedCommand,
  liftFirstListItemCommand,
  liftListItemCommand,
  linkSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  selectTextNearPosCommand,
  setBlockTypeCommand,
  strongSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockTypeCommand,
} from '@milkdown/kit/preset/commonmark';
import { insert } from '@milkdown/kit/utils';
import {
  createTable,
  strikethroughSchema,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm';
import { liftListItem, wrapInList } from '@milkdown/kit/prose/schema-list';
import type { Attrs, MarkType } from '@milkdown/kit/prose/model';
import { Slice } from '@milkdown/kit/prose/model';
import { NodeSelection, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import { liftTarget } from '@milkdown/kit/prose/transform';
import {
  boldIcon,
  bulletListIcon,
  chevronDownIcon,
  codeBlockIcon,
  codeIcon,
  dividerIcon,
  imageIcon,
  italicIcon,
  linkIcon,
  mathIcon,
  orderedListIcon,
  quoteIcon,
  strikethroughIcon,
  tableIcon,
  todoListIcon,
} from './icons';

type HeadingValue = number | null;
type ListKind = 'bullet-list' | 'ordered-list' | 'task-list';
type BaseBlockKind = 'paragraph' | 'heading' | 'code-block';

type BlockSnapshot = {
  baseBlock: BaseBlockKind;
  headingLevel: HeadingValue;
  listKind: ListKind | null;
  inQuote: boolean;
  inCodeBlock: boolean;
};

type SelectionBlockContext = {
  headingLevel: HeadingValue | 'mixed';
  listKind: ListKind | null | 'mixed';
  inQuote: boolean | 'mixed';
  inCodeBlock: boolean | 'mixed';
  hasAnyList: boolean;
  hasAnyQuote: boolean;
  hasAnyCodeBlock: boolean;
};

type TopBarItem = {
  icon: string;
  active: (ctx: Ctx) => boolean;
  onRun?: (ctx: Ctx) => void;
  selector?: {
    options: Array<{ label: string; onSelect: (ctx: Ctx) => void }>;
    activeLabel: (ctx: Ctx) => string;
    chevronIcon?: string;
  };
};

type TopBarGroup = {
  addItem: (key: string, item: TopBarItem) => TopBarGroup;
};

type TopBarBuilder = {
  clear: () => void;
  addGroup: (key: string, label: string) => TopBarGroup;
};

const headingOptions: Array<{ label: string; level: HeadingValue }> = [
  { label: 'Paragraph', level: null },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
  { label: 'Heading 4', level: 4 },
  { label: 'Heading 5', level: 5 },
  { label: 'Heading 6', level: 6 },
];

function getViewState(ctx: Ctx): EditorState {
  return ctx.get(editorViewCtx).state;
}

function getSelectionResolvedPositions(state: EditorState): number[] {
  const { doc, selection } = state;
  if (selection.empty) {
    return [selection.from];
  }

  const positions = new Set<number>();
  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (!node.isTextblock) {
      return;
    }

    positions.add(Math.min(pos + 1, doc.content.size));
  });

  if (positions.size === 0) {
    positions.add(selection.from);
  }

  return Array.from(positions).sort((left, right) => left - right);
}

function getBlockSnapshotAtPos(ctx: Ctx, pos: number): BlockSnapshot {
  const state = getViewState(ctx);
  const resolved = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));

  let baseBlock: BaseBlockKind = 'paragraph';
  let headingLevel: HeadingValue = null;
  let listKind: ListKind | null = null;
  let inQuote = false;
  let inCodeBlock = false;

  for (let depth = resolved.depth; depth >= 0; depth -= 1) {
    const node = resolved.node(depth);

    if (node.type === codeBlockSchema.type(ctx)) {
      baseBlock = 'code-block';
      inCodeBlock = true;
    } else if (node.type === headingSchema.type(ctx) && baseBlock === 'paragraph') {
      baseBlock = 'heading';
      headingLevel = typeof node.attrs.level === 'number' ? node.attrs.level : null;
    } else if (node.type === blockquoteSchema.type(ctx)) {
      inQuote = true;
    } else if (node.type === listItemSchema.type(ctx) && listKind === null) {
      if (node.attrs.checked != null) {
        listKind = 'task-list';
      } else {
        listKind = node.attrs.listType === 'ordered' ? 'ordered-list' : 'bullet-list';
      }
    }
  }

  return { baseBlock, headingLevel, listKind, inQuote, inCodeBlock };
}

function getUniformValue<T>(values: T[]): T | 'mixed' {
  const [first, ...rest] = values;
  if (first === undefined) {
    return 'mixed';
  }

  return rest.every((value) => value === first) ? first : 'mixed';
}

function getSelectionBlockContext(ctx: Ctx): SelectionBlockContext {
  const snapshots = getSelectionResolvedPositions(getViewState(ctx)).map((pos) => getBlockSnapshotAtPos(ctx, pos));

  return {
    headingLevel: getUniformValue(snapshots.map((snapshot) => (
      snapshot.baseBlock === 'heading' ? snapshot.headingLevel : null
    ))),
    listKind: getUniformValue(snapshots.map((snapshot) => snapshot.listKind)),
    inQuote: getUniformValue(snapshots.map((snapshot) => snapshot.inQuote)),
    inCodeBlock: getUniformValue(snapshots.map((snapshot) => snapshot.inCodeBlock)),
    hasAnyList: snapshots.some((snapshot) => snapshot.listKind !== null),
    hasAnyQuote: snapshots.some((snapshot) => snapshot.inQuote),
    hasAnyCodeBlock: snapshots.some((snapshot) => snapshot.inCodeBlock),
  };
}

function getHeadingLabel(ctx: Ctx): string {
  const headingLevel = getSelectionBlockContext(ctx).headingLevel;
  if (headingLevel === 'mixed') {
    return 'Multiple';
  }

  return headingOptions.find((option) => option.level === headingLevel)?.label ?? 'Paragraph';
}

function setHeadingLevel(ctx: Ctx, level: HeadingValue): void {
  const commands = ctx.get(commandsCtx);
  if (level == null) {
    commands.call(setBlockTypeCommand.key, { nodeType: paragraphSchema.type(ctx) });
    return;
  }

  commands.call(setBlockTypeCommand.key, {
    nodeType: headingSchema.type(ctx),
    attrs: { level },
  });
}

function isMarkActive(ctx: Ctx, markType: MarkType): boolean {
  const commands = ctx.get(commandsCtx);
  const selected = commands.call(isMarkSelectedCommand.key, markType);
  if (selected) {
    return true;
  }

  const state = getViewState(ctx);
  if (state.storedMarks) {
    return state.storedMarks.some((mark) => mark.type === markType);
  }

  if (state.selection instanceof TextSelection && state.selection.$cursor) {
    return state.selection.$cursor.marks().some((mark) => mark.type === markType);
  }

  return false;
}

function unwrapBlockquote(ctx: Ctx): boolean {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const range = state.selection.$from.blockRange(state.selection.$to);
  const target = range ? liftTarget(range) : null;
  if (!range || target == null) {
    return false;
  }

  view.dispatch(state.tr.lift(range, target).scrollIntoView());
  return true;
}

function unwrapList(ctx: Ctx): boolean {
  const view = ctx.get(editorViewCtx);
  const listItemType = listItemSchema.type(ctx);
  let changed = false;

  for (let index = 0; index < 8; index += 1) {
    const state = view.state;
    const lifted = liftListItem(listItemType)(state, view.dispatch)
      || ctx.get(commandsCtx).call(liftListItemCommand.key)
      || ctx.get(commandsCtx).call(liftFirstListItemCommand.key);

    if (!lifted) {
      break;
    }

    changed = true;
    if (!getSelectionBlockContext(ctx).hasAnyList) {
      break;
    }
  }

  return changed;
}

function normalizeSelectionToParagraph(ctx: Ctx): void {
  const commands = ctx.get(commandsCtx);

  for (let index = 0; index < 8; index += 1) {
    const selectionContext = getSelectionBlockContext(ctx);
    let changed = false;

    if (selectionContext.hasAnyCodeBlock) {
      changed = commands.call(setBlockTypeCommand.key, { nodeType: paragraphSchema.type(ctx) }) || changed;
    }

    if (selectionContext.hasAnyQuote) {
      changed = unwrapBlockquote(ctx) || changed;
    }

    if (selectionContext.hasAnyList) {
      changed = unwrapList(ctx) || changed;
    }

    if (!changed) {
      return;
    }
  }
}

function wrapSelectionInList(ctx: Ctx, kind: ListKind): boolean {
  const view = ctx.get(editorViewCtx);
  const { state } = view;

  switch (kind) {
    case 'bullet-list':
      return wrapInList(bulletListSchema.type(ctx))(state, view.dispatch);
    case 'ordered-list':
      return wrapInList(orderedListSchema.type(ctx))(state, view.dispatch);
    case 'task-list':
      return ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, {
        nodeType: listItemSchema.type(ctx),
        attrs: { checked: false } as Attrs,
      });
  }
}

function toggleList(ctx: Ctx, kind: ListKind): void {
  const selectionContext = getSelectionBlockContext(ctx);
  if (selectionContext.listKind === kind) {
    void unwrapList(ctx);
    return;
  }

  normalizeSelectionToParagraph(ctx);
  void wrapSelectionInList(ctx, kind);
}

function toggleBlockquote(ctx: Ctx): void {
  const selectionContext = getSelectionBlockContext(ctx);
  if (selectionContext.inQuote === true) {
    void unwrapBlockquote(ctx);
    return;
  }

  normalizeSelectionToParagraph(ctx);
  ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, { nodeType: blockquoteSchema.type(ctx) });
}

function toggleCodeBlock(ctx: Ctx): void {
  const commands = ctx.get(commandsCtx);
  const selectionContext = getSelectionBlockContext(ctx);
  if (selectionContext.inCodeBlock === true) {
    commands.call(setBlockTypeCommand.key, { nodeType: paragraphSchema.type(ctx) });
    return;
  }

  normalizeSelectionToParagraph(ctx);
  commands.call(setBlockTypeCommand.key, { nodeType: codeBlockSchema.type(ctx) });
}

function isInlineMathSelected(ctx: Ctx): boolean {
  const { selection } = ctx.get(editorViewCtx).state;
  return selection instanceof NodeSelection && selection.node.type.name === 'math_inline';
}

function replaceSelectionWithMarkdown(ctx: Ctx, markdown: string, inline: boolean): void {
  if (inline) {
    insert(markdown, true)(ctx);
    return;
  }

  const view = ctx.get(editorViewCtx);
  const parser = ctx.get(parserCtx);
  const doc = parser(markdown);
  if (!doc) {
    return;
  }

  const contentSlice = view.state.selection.content();
  const replacement = new Slice(doc.content, contentSlice.openStart, contentSlice.openEnd);
  view.dispatch(view.state.tr.replaceSelection(replacement).scrollIntoView());
}

function toggleInlineMath(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  const { selection, tr } = view.state;

  if (selection instanceof NodeSelection && selection.node.type.name === 'math_inline') {
    const value = String(selection.node.attrs.value ?? '');
    view.dispatch(tr.insertText(value, selection.from, selection.to).scrollIntoView());
    return;
  }

  const selectedText = view.state.doc.textBetween(selection.from, selection.to);
  const value = selectedText.length > 0 ? selectedText : 'x';
  replaceSelectionWithMarkdown(ctx, `$${value}$`, true);
}

function insertBlockMath(ctx: Ctx): void {
  replaceSelectionWithMarkdown(ctx, '$$\n\n$$', false);
}

export function createTopBarConfig() {
  return {
    buildTopBar: (builder: TopBarBuilder) => {
      builder.clear();

      builder.addGroup('heading', 'Heading').addItem('heading-selector', {
        icon: '',
        active: () => false,
        selector: {
          chevronIcon: chevronDownIcon,
          activeLabel: (ctx: Ctx) => getHeadingLabel(ctx),
          options: headingOptions.map((option) => ({
            label: option.label,
            onSelect: (ctx: Ctx) => {
              setHeadingLevel(ctx, option.level);
            },
          })),
        },
      });

      builder
        .addGroup('formatting', 'Formatting')
        .addItem('bold', {
          icon: boldIcon,
          active: (ctx: Ctx) => isMarkActive(ctx, strongSchema.type(ctx)),
          onRun: (ctx: Ctx) => {
            ctx.get(commandsCtx).call(toggleStrongCommand.key);
          },
        })
        .addItem('italic', {
          icon: italicIcon,
          active: (ctx: Ctx) => isMarkActive(ctx, emphasisSchema.type(ctx)),
          onRun: (ctx: Ctx) => {
            ctx.get(commandsCtx).call(toggleEmphasisCommand.key);
          },
        })
        .addItem('strikethrough', {
          icon: strikethroughIcon,
          active: (ctx: Ctx) => isMarkActive(ctx, strikethroughSchema.type(ctx)),
          onRun: (ctx: Ctx) => {
            ctx.get(commandsCtx).call(toggleStrikethroughCommand.key);
          },
        })
        .addItem('code', {
          icon: codeIcon,
          active: (ctx: Ctx) => isMarkActive(ctx, inlineCodeSchema.type(ctx)),
          onRun: (ctx: Ctx) => {
            const view = ctx.get(editorViewCtx);
            const markType = inlineCodeSchema.type(ctx);
            if (view.state.selection.empty) {
              if (isMarkActive(ctx, markType)) {
                view.dispatch(view.state.tr.removeStoredMark(markType));
              } else {
                view.dispatch(view.state.tr.addStoredMark(markType.create()));
              }
              return;
            }

            ctx.get(commandsCtx).call(toggleInlineCodeCommand.key);
          },
        })
        .addItem('inline-math', {
          icon: mathIcon,
          active: (ctx: Ctx) => isInlineMathSelected(ctx),
          onRun: (ctx: Ctx) => {
            toggleInlineMath(ctx);
          },
        });

      builder
        .addGroup('list', 'List')
        .addItem('bullet-list', {
          icon: bulletListIcon,
          active: (ctx: Ctx) => getSelectionBlockContext(ctx).listKind === 'bullet-list',
          onRun: (ctx: Ctx) => {
            toggleList(ctx, 'bullet-list');
          },
        })
        .addItem('ordered-list', {
          icon: orderedListIcon,
          active: (ctx: Ctx) => getSelectionBlockContext(ctx).listKind === 'ordered-list',
          onRun: (ctx: Ctx) => {
            toggleList(ctx, 'ordered-list');
          },
        })
        .addItem('task-list', {
          icon: todoListIcon,
          active: (ctx: Ctx) => getSelectionBlockContext(ctx).listKind === 'task-list',
          onRun: (ctx: Ctx) => {
            toggleList(ctx, 'task-list');
          },
        });

      const insertGroup = builder.addGroup('insert', 'Insert');
      insertGroup.addItem('link', {
        icon: linkIcon,
        active: (ctx: Ctx) => isMarkActive(ctx, linkSchema.type(ctx)),
        onRun: (ctx: Ctx) => {
          const view = ctx.get(editorViewCtx);
          const markType = linkSchema.type(ctx);
          if (view.state.selection.empty && isMarkActive(ctx, markType)) {
            view.dispatch(view.state.tr.removeStoredMark(markType));
            return;
          }

          ctx.get(commandsCtx).call(toggleLinkCommand.key);
        },
      });
      insertGroup.addItem('image', {
        icon: imageIcon,
        active: () => false,
        onRun: (ctx: Ctx) => {
          ctx.get(commandsCtx).call(addBlockTypeCommand.key, {
            nodeType: imageBlockSchema.type(ctx),
          });
        },
      });
      insertGroup.addItem('table', {
        icon: tableIcon,
        active: () => false,
        onRun: (ctx: Ctx) => {
          const view = ctx.get(editorViewCtx);
          const { from } = view.state.selection;
          const commands = ctx.get(commandsCtx);
          commands.call(addBlockTypeCommand.key, { nodeType: createTable(ctx, 3, 3) });
          commands.call(selectTextNearPosCommand.key, { pos: from });
        },
      });
      insertGroup.addItem('math-block', {
        icon: mathIcon,
        active: () => false,
        onRun: (ctx: Ctx) => {
          insertBlockMath(ctx);
        },
      });

      builder.addGroup('block', 'Block').addItem('code-block', {
        icon: codeBlockIcon,
        active: (ctx: Ctx) => getSelectionBlockContext(ctx).inCodeBlock === true,
        onRun: (ctx: Ctx) => {
          toggleCodeBlock(ctx);
        },
      });

      builder
        .addGroup('more', 'More')
        .addItem('quote', {
          icon: quoteIcon,
          active: (ctx: Ctx) => getSelectionBlockContext(ctx).inQuote === true,
          onRun: (ctx: Ctx) => {
            toggleBlockquote(ctx);
          },
        })
        .addItem('hr', {
          icon: dividerIcon,
          active: () => false,
          onRun: (ctx: Ctx) => {
            ctx.get(commandsCtx).call(addBlockTypeCommand.key, { nodeType: hrSchema.type(ctx) });
          },
        });
    },
  };
}
