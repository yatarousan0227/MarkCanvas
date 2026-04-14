import remarkParse from 'remark-parse';
import { unified } from 'unified';

type PositionPoint = {
  line?: number;
  column?: number;
  offset?: number;
};

type MarkdownPosition = {
  start?: PositionPoint;
  end?: PositionPoint;
};

type MarkdownNode = {
  type?: string;
  position?: MarkdownPosition;
  children?: MarkdownNode[];
  [key: string]: unknown;
};

type MarkdownRoot = MarkdownNode & {
  children?: MarkdownNode[];
};

export type MarkdownSnapshotBlock = {
  fingerprint: string;
  source: string;
  trailing: string;
  type: string;
};

export type MarkdownSnapshot = {
  blocks: MarkdownSnapshotBlock[];
  leading: string;
  markdown: string;
};

const CANONICAL_BLOCK_SEPARATOR = '\n\n';

function getLineOffsets(markdown: string): number[] {
  const offsets = [0];

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === '\n') {
      offsets.push(index + 1);
    }
  }

  return offsets;
}

function getOffset(
  point: PositionPoint | undefined,
  markdown: string,
  lineOffsets: number[],
  fallback: number,
): number {
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

function normalizeNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeNode(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const node = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const key of Object.keys(node).sort()) {
    if (key === 'children' || key === 'data' || key === 'position' || key === 'spread') {
      continue;
    }

    normalized[key] = normalizeNode(node[key]);
  }

  if (Array.isArray(node.children)) {
    normalized.children = node.children.map((child) => normalizeNode(child));
  }

  return normalized;
}

function getFingerprint(node: MarkdownNode): string {
  return JSON.stringify(normalizeNode(node));
}

function getBlockMatches(baseline: string[], current: string[]): number[] {
  const rows = baseline.length;
  const cols = current.length;
  const dp = Array.from({ length: rows + 1 }, () => Array<number>(cols + 1).fill(0));

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      if (baseline[row] === current[col]) {
        dp[row][col] = dp[row + 1][col + 1] + 1;
      } else {
        dp[row][col] = Math.max(dp[row + 1][col], dp[row][col + 1]);
      }
    }
  }

  const matches = Array<number>(cols).fill(-1);
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

function parseMarkdown(markdown: string): MarkdownRoot {
  return unified().use(remarkParse).parse(markdown) as MarkdownRoot;
}

export function createMarkdownSnapshot(markdown: string): MarkdownSnapshot {
  const root = parseMarkdown(markdown);
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
      fingerprint: getFingerprint(node),
      source: markdown.slice(start, end),
      trailing: markdown.slice(end, nextStart),
      type: node.type ?? 'unknown',
    };
  });

  const leading = markdown.slice(
    0,
    getOffset(children[0]?.position?.start, markdown, lineOffsets, 0),
  );

  return {
    blocks,
    leading,
    markdown,
  };
}

export function reconcileMarkdownSnapshots(
  baseline: MarkdownSnapshot,
  current: MarkdownSnapshot,
): string {
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
    const currentBlock = current.blocks[index];
    const baselineBlock = baselineIndex >= 0 ? baseline.blocks[baselineIndex] : null;

    result += baselineBlock?.source ?? currentBlock.source;

    if (index === current.blocks.length - 1) {
      result += baselineIndex === baseline.blocks.length - 1
        ? baselineBlock?.trailing ?? ''
        : currentBlock.trailing;
      continue;
    }

    const nextBaselineIndex = matches[index + 1];
    const shouldReuseSeparator = baselineIndex >= 0 && nextBaselineIndex === baselineIndex + 1;
    result += shouldReuseSeparator
      ? baseline.blocks[baselineIndex].trailing
      : CANONICAL_BLOCK_SEPARATOR;
  }

  return result;
}

export function reconcileMarkdown(originalMarkdown: string, currentMarkdown: string): string {
  return reconcileMarkdownSnapshots(
    createMarkdownSnapshot(originalMarkdown),
    createMarkdownSnapshot(currentMarkdown),
  );
}
