export type TableAlignment = 'left' | 'center' | 'right' | null;

export type TableWidthSpec = {
  columnUnits: number[];
  aligns: TableAlignment[];
};

export type TableWidthState = {
  specs: TableWidthSpec[];
  dirtyTableIndexes: Set<number>;
};

export type MarkdownTableWidthRange = {
  tableIndex: number;
  delimiterLine: number;
  spec: TableWidthSpec;
};

const MIN_TABLE_WIDTH_UNIT = 3;
const DEFAULT_TABLE_WIDTH_UNIT = 6;
const TABLE_WIDTH_UNITS_PER_COLUMN = 12;

type LineEntry = {
  text: string;
  eol: string;
};

type FenceState = {
  marker: '`' | '~';
  length: number;
} | null;

function splitLines(markdown: string): LineEntry[] {
  const matches = markdown.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g);
  const lines: LineEntry[] = [];

  for (const match of matches) {
    if (match[0] === '') {
      continue;
    }

    lines.push({
      text: match[1] ?? '',
      eol: match[2] ?? '',
    });
  }

  return lines;
}

function countTrailingBackslashes(value: string): number {
  let count = 0;
  for (let index = value.length - 1; index >= 0 && value[index] === '\\'; index -= 1) {
    count += 1;
  }

  return count;
}

function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '|' && countTrailingBackslashes(current) % 2 === 0) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);

  if (/^\s*\|/.test(line)) {
    cells.shift();
  }

  if (/\|\s*$/.test(line)) {
    cells.pop();
  }

  return cells;
}

function parseDelimiterCell(cell: string): { unit: number; align: TableAlignment } | null {
  const value = cell.trim();
  if (!/^:?-{3,}:?$/.test(value)) {
    return null;
  }

  const startsWithColon = value.startsWith(':');
  const endsWithColon = value.endsWith(':');
  const unit = Math.max(MIN_TABLE_WIDTH_UNIT, (value.match(/-/g) ?? []).length);

  if (startsWithColon && endsWithColon) {
    return { unit, align: 'center' };
  }

  if (endsWithColon) {
    return { unit, align: 'right' };
  }

  if (startsWithColon) {
    return { unit, align: 'left' };
  }

  return { unit, align: null };
}

function parseDelimiterLine(line: string): TableWidthSpec | null {
  const cells = splitTableRow(line);
  if (cells.length === 0 || !line.includes('|')) {
    return null;
  }

  const parsed = cells.map(parseDelimiterCell);
  if (parsed.some((entry) => entry == null)) {
    return null;
  }

  return {
    columnUnits: parsed.map((entry) => entry?.unit ?? DEFAULT_TABLE_WIDTH_UNIT),
    aligns: parsed.map((entry) => entry?.align ?? null),
  };
}

function updateFenceState(line: string, current: FenceState): FenceState {
  const match = /^( {0,3})(`{3,}|~{3,})/.exec(line);
  if (!match) {
    return current;
  }

  const fence = match[2] ?? '';
  const marker = fence[0] as '`' | '~';
  const length = fence.length;

  if (!current) {
    return { marker, length };
  }

  if (current.marker === marker && length >= current.length) {
    return null;
  }

  return current;
}

function isLikelyHeaderLine(line: string, columnCount: number): boolean {
  if (!line.includes('|')) {
    return false;
  }

  return splitTableRow(line).length === columnCount;
}

export function extractTableWidthRanges(markdown: string): MarkdownTableWidthRange[] {
  const lines = splitLines(markdown);
  const ranges: MarkdownTableWidthRange[] = [];
  let fence: FenceState = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]?.text ?? '';
    const nextFence = updateFenceState(line, fence);

    if (!fence && lineIndex > 0) {
      const spec = parseDelimiterLine(line);
      const previousLine = lines[lineIndex - 1]?.text ?? '';
      if (spec && isLikelyHeaderLine(previousLine, spec.columnUnits.length)) {
        ranges.push({
          tableIndex: ranges.length,
          delimiterLine: lineIndex,
          spec,
        });
      }
    }

    fence = nextFence;
  }

  return ranges;
}

export function createTableWidthState(markdown: string): TableWidthState {
  return {
    specs: extractTableWidthRanges(markdown).map((range) => ({
      columnUnits: [...range.spec.columnUnits],
      aligns: [...range.spec.aligns],
    })),
    dirtyTableIndexes: new Set(),
  };
}

function normalizeUnit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TABLE_WIDTH_UNIT;
  }

  return Math.max(MIN_TABLE_WIDTH_UNIT, Math.round(value ?? DEFAULT_TABLE_WIDTH_UNIT));
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);

  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }

  return a;
}

function compactEquivalentRatio(units: number[]): number[] {
  const divisor = units.reduce((current, unit) => greatestCommonDivisor(current, unit), 0);
  if (divisor <= 1) {
    return units;
  }

  const reducedUnits = units.map((unit) => unit / divisor);
  const smallestReducedUnit = Math.min(...reducedUnits);
  if (smallestReducedUnit <= 0) {
    return units;
  }

  const scale = Math.max(1, Math.ceil(MIN_TABLE_WIDTH_UNIT / smallestReducedUnit));
  const compactedUnits = reducedUnits.map((unit) => unit * scale);

  if (compactedUnits.reduce((sum, unit) => sum + unit, 0) >= units.reduce((sum, unit) => sum + unit, 0)) {
    return units;
  }

  return compactedUnits;
}

export function normalizeSpecForColumnCount(
  spec: TableWidthSpec | undefined,
  columnCount: number,
  currentAligns: TableAlignment[] = [],
): TableWidthSpec {
  const safeColumnCount = Math.max(0, columnCount);
  const columnUnits: number[] = [];
  const aligns: TableAlignment[] = [];

  for (let index = 0; index < safeColumnCount; index += 1) {
    columnUnits.push(normalizeUnit(spec?.columnUnits[index]));
    aligns.push(index in currentAligns ? currentAligns[index] ?? null : spec?.aligns[index] ?? null);
  }

  return { columnUnits, aligns };
}

export function normalizeColumnUnitsFromWidths(widths: number[]): number[] {
  if (widths.length === 0) {
    return [];
  }

  const safeWidths = widths.map((width) => Math.max(0, Number.isFinite(width) ? width : 0));
  const totalWidth = safeWidths.reduce((sum, width) => sum + width, 0);
  const totalUnits = widths.length * TABLE_WIDTH_UNITS_PER_COLUMN;

  if (totalWidth <= 0) {
    return Array.from({ length: widths.length }, () => DEFAULT_TABLE_WIDTH_UNIT);
  }

  const rawUnits = safeWidths.map((width) => (width / totalWidth) * totalUnits);
  const units = rawUnits.map((unit) => Math.max(MIN_TABLE_WIDTH_UNIT, Math.floor(unit)));
  let remainder = totalUnits - units.reduce((sum, unit) => sum + unit, 0);
  const fractions = rawUnits
    .map((unit, index) => ({ index, fraction: unit - Math.floor(unit) }))
    .sort((left, right) => right.fraction - left.fraction);

  while (remainder > 0) {
    for (const { index } of fractions) {
      if (remainder <= 0) {
        break;
      }

      units[index] += 1;
      remainder -= 1;
    }
  }

  while (remainder < 0) {
    const largestIndex = units.reduce((largest, unit, index) => (
      unit > units[largest] ? index : largest
    ), 0);

    if (units[largestIndex] <= MIN_TABLE_WIDTH_UNIT) {
      break;
    }

    units[largestIndex] -= 1;
    remainder += 1;
  }

  return compactEquivalentRatio(units);
}

export function setTableWidthSpec(
  state: TableWidthState,
  tableIndex: number,
  columnUnits: number[],
  aligns: TableAlignment[] = [],
): void {
  const normalized: TableWidthSpec = {
    columnUnits: columnUnits.map(normalizeUnit),
    aligns: columnUnits.map((_, index) => (
      index in aligns ? aligns[index] ?? null : state.specs[tableIndex]?.aligns[index] ?? null
    )),
  };

  state.specs[tableIndex] = normalized;
  state.dirtyTableIndexes.add(tableIndex);
}

export function insertTableWidthColumn(
  state: TableWidthState,
  tableIndex: number,
  columnIndex: number,
  currentColumnCount: number,
): void {
  const spec = normalizeSpecForColumnCount(state.specs[tableIndex], currentColumnCount);
  const insertIndex = Math.max(0, Math.min(columnIndex, spec.columnUnits.length));
  const columnUnits = [...spec.columnUnits];
  const aligns = [...spec.aligns];

  columnUnits.splice(insertIndex, 0, DEFAULT_TABLE_WIDTH_UNIT);
  aligns.splice(insertIndex, 0, null);
  setTableWidthSpec(state, tableIndex, columnUnits, aligns);
}

export function deleteTableWidthColumn(
  state: TableWidthState,
  tableIndex: number,
  columnIndex: number,
  currentColumnCount: number,
): void {
  const spec = normalizeSpecForColumnCount(state.specs[tableIndex], currentColumnCount);
  if (spec.columnUnits.length <= 1) {
    return;
  }

  const deleteIndex = Math.max(0, Math.min(columnIndex, spec.columnUnits.length - 1));
  const columnUnits = [...spec.columnUnits];
  const aligns = [...spec.aligns];

  columnUnits.splice(deleteIndex, 1);
  aligns.splice(deleteIndex, 1);
  setTableWidthSpec(state, tableIndex, columnUnits, aligns);
}

function buildDelimiterCell(unit: number, align: TableAlignment): string {
  const hyphens = '-'.repeat(normalizeUnit(unit));

  switch (align) {
    case 'center':
      return `:${hyphens}:`;
    case 'right':
      return `${hyphens}:`;
    case 'left':
    case null:
      return hyphens;
  }
}

function specsEqual(left: TableWidthSpec, right: TableWidthSpec): boolean {
  return left.columnUnits.length === right.columnUnits.length
    && left.columnUnits.every((unit, index) => unit === right.columnUnits[index])
    && left.aligns.every((align, index) => align === right.aligns[index]);
}

function buildDelimiterLine(spec: TableWidthSpec): string {
  return `| ${spec.columnUnits.map((unit, index) => (
    buildDelimiterCell(unit, spec.aligns[index] ?? null)
  )).join(' | ')} |`;
}

export function applyTableWidthState(markdown: string, state: TableWidthState): string {
  const lines = splitLines(markdown);
  const ranges = extractTableWidthRanges(markdown);

  for (const range of ranges) {
    const baseSpec = state.specs[range.tableIndex];
    const desiredSpec = normalizeSpecForColumnCount(
      baseSpec,
      range.spec.columnUnits.length,
      range.spec.aligns,
    );

    if (specsEqual(range.spec, desiredSpec)) {
      continue;
    }

    const line = lines[range.delimiterLine];
    if (!line) {
      continue;
    }

    line.text = buildDelimiterLine(desiredSpec);
  }

  return lines.map((line) => `${line.text}${line.eol}`).join('');
}

export function getTableWidthRenderSpec(
  state: TableWidthState,
  tableIndex: number,
  columnCount: number,
): TableWidthSpec {
  return normalizeSpecForColumnCount(state.specs[tableIndex], columnCount);
}
