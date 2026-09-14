import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import markdownItKatexImport from "@vscode/markdown-it-katex";
import type { AnchorBlock, AnchorMap } from "./types";

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;
type Token = ReturnType<MarkdownItInstance["parse"]>[number];

function unwrapPlugin(
  mod: unknown,
): (md: MarkdownItInstance, options?: object) => void {
  let cur: unknown = mod;
  while (cur && typeof cur === "object" && "default" in cur) {
    cur = (cur as { default: unknown }).default;
  }
  if (typeof cur !== "function") {
    throw new Error("Failed to load @vscode/markdown-it-katex");
  }
  return cur as (md: MarkdownItInstance, options?: object) => void;
}

/** GFM + TeX ($…$ / $$…$$) via KaTeX. */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
})
  .use(taskLists, { enabled: false, label: true })
  .use(unwrapPlugin(markdownItKatexImport), { throwOnError: false, errorColor: "#cc0000" });

const VOID_BLOCKS = new Set(["fence", "code_block", "hr", "html_block", "math_block"]);

function lineStartOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

function rangeFromMap(
  offsets: number[],
  sourceLength: number,
  map: [number, number],
): { sourceStart: number; sourceEnd: number } {
  const [startLine, endLine] = map;
  const sourceStart = offsets[startLine] ?? sourceLength;
  const sourceEnd =
    endLine < offsets.length ? (offsets[endLine] ?? sourceLength) : sourceLength;
  return { sourceStart, sourceEnd };
}

function isTopLevelBlock(token: Token): boolean {
  if (token.level !== 0 || !token.map) return false;
  if (token.nesting === 1) return true;
  return token.nesting === 0 && VOID_BLOCKS.has(token.type);
}

function takeBlockSlice(tokens: Token[], start: number): { slice: Token[]; next: number } {
  const token = tokens[start]!;
  if (token.nesting === 0) {
    return { slice: tokens.slice(start, start + 1), next: start + 1 };
  }

  let depth = 1;
  let end = start + 1;
  while (end < tokens.length && depth > 0) {
    const t = tokens[end]!;
    if (t.nesting === 1) depth += 1;
    else if (t.nesting === -1) depth -= 1;
    end += 1;
  }
  return { slice: tokens.slice(start, end), next: end };
}

export function buildAnchorMap(source: string): AnchorMap {
  const tokens = md.parse(source, {});
  const offsets = lineStartOffsets(source);
  const blocks: AnchorBlock[] = [];
  const parts: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (!isTopLevelBlock(token) || !token.map) {
      i += 1;
      continue;
    }

    const id = `block-${blocks.length}`;
    const { sourceStart, sourceEnd } = rangeFromMap(offsets, source.length, token.map as [number, number]);
    blocks.push({
      id,
      sourceStart,
      sourceEnd: Math.max(sourceStart + 1, sourceEnd),
    });

    const { slice, next } = takeBlockSlice(tokens, i);
    const inner = md.renderer.render(slice, md.options, {});
    parts.push(`<div class="vellum-block" data-vellum-anchor="${id}">${inner}</div>`);
    i = next;
  }

  if (parts.length === 0) {
    blocks.push({ id: "block-0", sourceStart: 0, sourceEnd: Math.max(1, source.length) });
    return {
      blocks,
      html: `<div class="vellum-block vellum-empty" data-vellum-anchor="block-0"></div>`,
    };
  }

  return {
    blocks,
    html: parts.join(""),
  };
}

export function findBlockBySourcePos(
  blocks: AnchorBlock[],
  sourcePos: number,
): AnchorBlock | null {
  if (blocks.length === 0) return null;

  for (const block of blocks) {
    if (sourcePos >= block.sourceStart && sourcePos < block.sourceEnd) {
      return block;
    }
  }

  if (sourcePos <= blocks[0]!.sourceStart) return blocks[0]!;
  return blocks[blocks.length - 1]!;
}

export function sourcePosFromLogical(
  blocks: AnchorBlock[],
  blockId: string,
  relativePosition: number,
): number {
  const block = blocks.find((b) => b.id === blockId) ?? blocks[0];
  if (!block) return 0;
  const span = Math.max(1, block.sourceEnd - block.sourceStart);
  const t = Math.min(1, Math.max(0, relativePosition));
  return block.sourceStart + t * span;
}
