import {
  deleteTableWidthColumn,
  getTableWidthRenderSpec,
  insertTableWidthColumn,
  normalizeColumnUnitsFromWidths,
  setTableWidthSpec,
  type TableWidthState,
} from './table-widths';

type TableWidthManagerOptions = {
  getState: () => TableWidthState;
  onCommit: () => void;
  dispatchResizeTransaction?: () => void;
};

type DragState = {
  table: HTMLTableElement;
  tableIndex: number;
  boundaryIndex: number;
  startX: number;
  startWidths: number[];
  currentWidths: number[];
};

const MIN_COLUMN_WIDTH_PX = 18;

function getTableColumnCount(table: HTMLTableElement): number {
  return table.querySelector('tr')?.children.length ?? 0;
}

function ensureColgroup(table: HTMLTableElement, columnCount: number): HTMLTableColElement[] {
  let colgroup = table.querySelector(':scope > colgroup');
  if (!colgroup) {
    colgroup = document.createElement('colgroup');
    table.insertBefore(colgroup, table.firstChild);
  }

  while (colgroup.children.length < columnCount) {
    colgroup.appendChild(document.createElement('col'));
  }

  while (colgroup.children.length > columnCount) {
    colgroup.lastElementChild?.remove();
  }

  return Array.from(colgroup.children).filter(
    (child): child is HTMLTableColElement => child instanceof HTMLTableColElement,
  );
}

function applyColumnPercentages(table: HTMLTableElement, percentages: number[]): void {
  const cols = ensureColgroup(table, percentages.length);
  table.style.tableLayout = 'fixed';
  table.style.width = '100%';

  for (const [index, col] of cols.entries()) {
    col.style.width = `${percentages[index] ?? 0}%`;
  }
}

function unitsToPercentages(units: number[]): number[] {
  const total = units.reduce((sum, unit) => sum + unit, 0);
  if (total <= 0) {
    return units.map(() => 0);
  }

  return units.map((unit) => (unit / total) * 100);
}

function getColumnPixelWidths(table: HTMLTableElement, fallbackUnits: number[]): number[] {
  const firstRow = table.querySelector('tr');
  const cells = firstRow ? Array.from(firstRow.children) : [];
  const measuredWidths = cells.map((cell) => cell.getBoundingClientRect().width);

  if (
    measuredWidths.length === fallbackUnits.length
    && measuredWidths.every((width) => Number.isFinite(width) && width > 0)
  ) {
    return measuredWidths;
  }

  return fallbackUnits.map((unit) => Math.max(MIN_COLUMN_WIDTH_PX, unit * 12));
}

function getTableEntries(): Array<{ block: HTMLElement; table: HTMLTableElement }> {
  return Array.from(document.querySelectorAll<HTMLElement>('.milkdown-table-block'))
    .map((block) => {
      const table = block.querySelector<HTMLTableElement>('table.children');
      return table ? { block, table } : null;
    })
    .filter((entry): entry is { block: HTMLElement; table: HTMLTableElement } => entry != null);
}

export function createTableWidthManager(options: TableWidthManagerOptions) {
  let dragState: DragState | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let refreshQueued = false;

  const getTableIndex = (table: HTMLTableElement): number => (
    getTableEntries().findIndex((entry) => entry.table === table)
  );

  const scheduleRefresh = (): void => {
    if (refreshQueued) {
      return;
    }

    refreshQueued = true;
    queueMicrotask(() => {
      refresh();
      requestAnimationFrame(() => {
        refreshQueued = false;
        refresh();
      });
    });
  };

  const getColumnIndexFromX = (table: HTMLTableElement, clientX: number): number => {
    const firstRow = table.querySelector('tr');
    const cells = firstRow ? Array.from(firstRow.children) : [];

    for (const [index, cell] of cells.entries()) {
      const rect = cell.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        return index;
      }
    }

    return Math.max(0, cells.length - 1);
  };

  const getInsertColumnIndexFromX = (table: HTMLTableElement, clientX: number): number => {
    const firstRow = table.querySelector('tr');
    const cells = firstRow ? Array.from(firstRow.children) : [];

    if (cells.length === 0) {
      return 0;
    }

    for (const [index, cell] of cells.entries()) {
      const rect = cell.getBoundingClientRect();
      if (clientX <= rect.left) {
        return index;
      }

      if (clientX <= rect.right) {
        return clientX < rect.left + rect.width / 2 ? index : index + 1;
      }
    }

    return cells.length;
  };

  const getSelectedColumnIndex = (table: HTMLTableElement, fallbackX: number): number => {
    const firstRow = table.querySelector('tr');
    if (firstRow) {
      const cells = Array.from(firstRow.children);
      const selectedIndex = cells.findIndex((cell) => cell.classList.contains('selectedCell'));
      if (selectedIndex >= 0) {
        return selectedIndex;
      }
    }

    return getColumnIndexFromX(table, fallbackX);
  };

  const updateHandlePositions = (
    block: HTMLElement,
    table: HTMLTableElement,
    overridePercentages?: number[],
  ): void => {
    const layer = block.querySelector<HTMLElement>(':scope > .markcanvas-table-width-layer');
    if (!layer) {
      return;
    }

    const columnCount = getTableColumnCount(table);
    const spec = getTableWidthRenderSpec(options.getState(), getTableEntries().findIndex((entry) => entry.table === table), columnCount);
    const percentages = overridePercentages ?? unitsToPercentages(spec.columnUnits);
    let offset = 0;

    for (const [index, handle] of Array.from(layer.children).entries()) {
      if (!(handle instanceof HTMLElement)) {
        continue;
      }

      offset += percentages[index] ?? 0;
      handle.style.left = `${offset}%`;
    }
  };

  const refresh = (): void => {
    const entries = getTableEntries();

    if (!mutationObserver) {
      mutationObserver = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => (
          mutation.target instanceof Element
          && mutation.target.closest('.milkdown-table-block')
        ))) {
          scheduleRefresh();
        }
      });
      mutationObserver.observe(document.getElementById('app') ?? document.body, {
        childList: true,
        subtree: true,
      });
    }

    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        for (const entry of getTableEntries()) {
          updateHandlePositions(entry.block, entry.table);
        }
      });
    }

    for (const [tableIndex, { block, table }] of entries.entries()) {
      const columnCount = getTableColumnCount(table);
      if (columnCount <= 0) {
        continue;
      }

      const spec = getTableWidthRenderSpec(options.getState(), tableIndex, columnCount);
      applyColumnPercentages(table, unitsToPercentages(spec.columnUnits));
      block.classList.add('markcanvas-table-width-enabled');

      let layer = block.querySelector<HTMLElement>(':scope > .markcanvas-table-width-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'markcanvas-table-width-layer';
        layer.contentEditable = 'false';
        block.appendChild(layer);
        resizeObserver.observe(block);
      }

      while (layer.children.length < Math.max(0, columnCount - 1)) {
        const handle = document.createElement('div');
        handle.className = 'markcanvas-table-width-handle';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.title = 'Resize column';
        layer.appendChild(handle);
      }

      while (layer.children.length > Math.max(0, columnCount - 1)) {
        layer.lastElementChild?.remove();
      }

      for (const [boundaryIndex, handle] of Array.from(layer.children).entries()) {
        if (!(handle instanceof HTMLElement)) {
          continue;
        }

        handle.dataset.tableIndex = String(tableIndex);
        handle.dataset.boundaryIndex = String(boundaryIndex);
      }

      updateHandlePositions(block, table);
    }
  };

  const finishDrag = (): void => {
    if (!dragState) {
      return;
    }

    const { tableIndex, currentWidths } = dragState;
    const units = normalizeColumnUnitsFromWidths(currentWidths);
    const state = options.getState();
    setTableWidthSpec(state, tableIndex, units);
    dragState = null;
    options.dispatchResizeTransaction?.();
    options.onCommit();
    queueMicrotask(refresh);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!dragState) {
      return;
    }

    const {
      table,
      boundaryIndex,
      startX,
      startWidths,
    } = dragState;
    const delta = event.clientX - startX;
    const leftStart = startWidths[boundaryIndex] ?? MIN_COLUMN_WIDTH_PX;
    const rightStart = startWidths[boundaryIndex + 1] ?? MIN_COLUMN_WIDTH_PX;
    const pairTotal = leftStart + rightStart;
    const leftWidth = Math.max(
      MIN_COLUMN_WIDTH_PX,
      Math.min(pairTotal - MIN_COLUMN_WIDTH_PX, leftStart + delta),
    );
    const rightWidth = pairTotal - leftWidth;
    const nextWidths = [...startWidths];

    nextWidths[boundaryIndex] = leftWidth;
    nextWidths[boundaryIndex + 1] = rightWidth;
    dragState.currentWidths = nextWidths;
    const percentages = unitsToPercentages(nextWidths);
    applyColumnPercentages(table, percentages);
    updateHandlePositions(table.closest<HTMLElement>('.milkdown-table-block') ?? table, table, percentages);
  };

  const handlePointerUp = (): void => {
    window.removeEventListener('pointermove', handlePointerMove, true);
    window.removeEventListener('pointerup', handlePointerUp, true);
    window.removeEventListener('pointercancel', handlePointerUp, true);
    finishDrag();
  };

  const handlePointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('markcanvas-table-width-handle')) {
      return;
    }

    const tableIndex = Number(target.dataset.tableIndex);
    const boundaryIndex = Number(target.dataset.boundaryIndex);
    const entry = getTableEntries()[tableIndex];
    if (!entry || !Number.isInteger(boundaryIndex)) {
      return;
    }

    const columnCount = getTableColumnCount(entry.table);
    if (columnCount < 2 || boundaryIndex < 0 || boundaryIndex >= columnCount - 1) {
      return;
    }

    const state = options.getState();
    const spec = getTableWidthRenderSpec(state, tableIndex, columnCount);
    const startWidths = getColumnPixelWidths(entry.table, spec.columnUnits);

    event.preventDefault();
    event.stopPropagation();
    target.setPointerCapture?.(event.pointerId);

    dragState = {
      table: entry.table,
      tableIndex,
      boundaryIndex,
      startX: event.clientX,
      startWidths,
      currentWidths: startWidths,
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerUp, true);
  };

  const prepareTableOperation = (eventTarget: EventTarget | null): void => {
    if (!(eventTarget instanceof Element)) {
      return;
    }

    const button = eventTarget.closest<HTMLButtonElement>('.milkdown-table-block button');
    const block = button?.closest<HTMLElement>('.milkdown-table-block');
    const table = block?.querySelector<HTMLTableElement>('table.children');
    if (!button || !block || !table) {
      return;
    }

    const tableIndex = getTableIndex(table);
    const columnCount = getTableColumnCount(table);
    if (tableIndex < 0 || columnCount <= 0) {
      scheduleRefresh();
      return;
    }

    const lineHandle = button.closest<HTMLElement>('[data-role="y-line-drag-handle"]');
    if (lineHandle) {
      const rect = lineHandle.getBoundingClientRect();
      const insertIndex = getInsertColumnIndexFromX(table, rect.left + rect.width / 2);
      insertTableWidthColumn(options.getState(), tableIndex, insertIndex, columnCount);
      scheduleRefresh();
      return;
    }

    const columnHandle = button.closest<HTMLElement>('[data-role="col-drag-handle"]');
    const buttonGroup = button.closest<HTMLElement>('.button-group');
    if (columnHandle && buttonGroup) {
      const buttons = Array.from(buttonGroup.querySelectorAll('button'));
      const isDeleteButton = buttons.indexOf(button) === buttons.length - 1;

      if (isDeleteButton) {
        const rect = columnHandle.getBoundingClientRect();
        const deleteIndex = getSelectedColumnIndex(table, rect.left + rect.width / 2);
        deleteTableWidthColumn(options.getState(), tableIndex, deleteIndex, columnCount);
      } else {
        const spec = getTableWidthRenderSpec(options.getState(), tableIndex, columnCount);
        const widths = getColumnPixelWidths(table, spec.columnUnits);
        setTableWidthSpec(
          options.getState(),
          tableIndex,
          normalizeColumnUnitsFromWidths(widths),
          spec.aligns,
        );
      }

      scheduleRefresh();
      return;
    }

    scheduleRefresh();
  };

  document.addEventListener('pointerdown', handlePointerDown, true);

  return {
    refresh,
    prepareTableOperation,
    destroy(): void {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerUp, true);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      resizeObserver = null;
      mutationObserver = null;
      dragState = null;
    },
  };
}
