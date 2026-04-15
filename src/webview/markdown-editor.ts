import type { Editor } from '@milkdown/kit/core';
import { editorViewCtx, parserCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { Slice } from '@milkdown/kit/prose/model';
import { Selection, TextSelection } from '@milkdown/kit/prose/state';
import { Crepe } from '@milkdown/crepe';
import { applyTableWidthState, type TableWidthState } from './table-widths';
import { createMarkdownSnapshot, reconcileMarkdownSnapshots, type MarkdownSnapshot } from './markdown-reconciler';

type MarkdownEditorBridgeOptions = {
  getBaselineMarkdownSnapshot: () => MarkdownSnapshot | null;
  getCrepe: () => Crepe | null;
  getEditorInstance: () => Editor | null;
  getTableWidthState: () => TableWidthState;
  setSuppressUpdates: (value: boolean) => void;
  clearUserEditIntent: () => void;
  sendMarkdownUpdate: (markdown: string) => void;
  refreshEditorDecorations: () => void;
};

export function createMarkdownEditorBridge(options: MarkdownEditorBridgeOptions) {
  const configureMarkdownSerialization = (): void => {
    const crepe = options.getCrepe();
    if (!crepe) {
      return;
    }

    crepe.editor.config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (value) => ({
        ...value,
        bullet: '-' as const,
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
            if (preserveLiteralText(text) || /^[^*_\\]*\s+$/.test(text)) {
              return text;
            }

            return normalizeEscapedText(state.safe(text, {
              ...info,
              encode: [],
            }));
          },
        },
      }));
    });
  };

  const reconstructMarkdownForSave = (markdown: string): string => {
    let reconstructedMarkdown = markdown;
    const baselineMarkdownSnapshot = options.getBaselineMarkdownSnapshot();
    if (!baselineMarkdownSnapshot) {
      return applyTableWidthState(reconstructedMarkdown, options.getTableWidthState());
    }

    try {
      reconstructedMarkdown = reconcileMarkdownSnapshots(
        baselineMarkdownSnapshot,
        createMarkdownSnapshot(markdown),
      );
    } catch {
      reconstructedMarkdown = markdown;
    }

    return applyTableWidthState(reconstructedMarkdown, options.getTableWidthState());
  };

  const insertMarkdownAtSelection = (markdown: string): void => {
    const editorInstance = options.getEditorInstance();
    if (!editorInstance) {
      return;
    }

    options.setSuppressUpdates(true);
    try {
      editorInstance.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const parser = ctx.get(parserCtx);
        const doc = parser(markdown);
        if (!doc) {
          return;
        }

        const contentSlice = view.state.selection.content();
        const replacement = new Slice(doc.content, contentSlice.openStart, contentSlice.openEnd);
        view.dispatch(view.state.tr.replaceSelection(replacement).scrollIntoView());
      });
    } finally {
      options.setSuppressUpdates(false);
    }

    const crepe = options.getCrepe();
    if (!crepe) {
      return;
    }

    const nextMarkdown = reconstructMarkdownForSave(crepe.getMarkdown());
    options.clearUserEditIntent();
    options.sendMarkdownUpdate(nextMarkdown);
    queueMicrotask(() => {
      options.refreshEditorDecorations();
    });
  };

  const shouldSkipMarkdownReset = (markdown: string, force: boolean): boolean => {
    const crepe = options.getCrepe();
    if (!crepe) {
      return true;
    }

    const currentMarkdown = crepe.getMarkdown();
    if (currentMarkdown === markdown) {
      return true;
    }

    if (force) {
      return false;
    }

    try {
      return reconstructMarkdownForSave(currentMarkdown) === markdown;
    } catch {
      return false;
    }
  };

  const setEditorMarkdown = (markdown: string, force = false): void => {
    const editorInstance = options.getEditorInstance();
    if (!editorInstance || shouldSkipMarkdownReset(markdown, force)) {
      return;
    }

    options.setSuppressUpdates(true);
    options.clearUserEditIntent();
    const previousScrollX = window.scrollX;
    const previousScrollY = window.scrollY;
    try {
      editorInstance.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const parser = ctx.get(parserCtx);
        const doc = parser(markdown);
        if (!doc) {
          return;
        }

        const { state } = view;
        let tr = state.tr.replace(0, state.doc.content.size, new Slice(doc.content, 0, 0));
        const anchor = clampSelectionPosition(state.selection.anchor, tr.doc.content.size);
        const head = clampSelectionPosition(state.selection.head, tr.doc.content.size);

        try {
          tr = state.selection instanceof TextSelection
            ? tr.setSelection(TextSelection.between(tr.doc.resolve(anchor), tr.doc.resolve(head)))
            : tr.setSelection(Selection.near(tr.doc.resolve(anchor)));
        } catch {
          tr = tr.setSelection(Selection.near(tr.doc.resolve(anchor)));
        }

        view.dispatch(tr);
      });
    } finally {
      options.setSuppressUpdates(false);
    }

    restoreViewportScroll(previousScrollX, previousScrollY);
    requestAnimationFrame(() => {
      restoreViewportScroll(previousScrollX, previousScrollY);
    });
  };

  return {
    configureMarkdownSerialization,
    insertMarkdownAtSelection,
    reconstructMarkdownForSave,
    setEditorMarkdown,
  };
}

function preserveLiteralText(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9./_-]*$/.test(value);
}

function normalizeEscapedText(value: string): string {
  return value
    .replace(/\\\./g, '.')
    .replace(/([A-Za-z0-9./-])\\_([A-Za-z0-9./-])/g, '$1_$2')
    .replace(/([A-Za-z0-9])\\\*([A-Za-z0-9])/g, '$1*$2')
    .replace(/\\\[([^[\]\r\n]+)](?!\(|\[)/g, '[$1]');
}

function clampSelectionPosition(position: number, size: number): number {
  return Math.max(0, Math.min(position, size));
}

function restoreViewportScroll(x: number, y: number): void {
  window.scrollTo(x, y);
}
