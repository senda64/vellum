import type { EditorView } from "@codemirror/view";
import type { AnchorBlock, LogicalPosition } from "../markdown/types";

const ANCHOR_ATTR = "data-vellum-anchor";

export function editorRangeMetrics(
  view: EditorView,
  from: number,
  to: number,
): { top: number; height: number } {
  const docLen = view.state.doc.length;
  const startPos = Math.max(0, Math.min(from, docLen));
  const endPos = Math.max(startPos, Math.min(Math.max(to - 1, startPos), docLen));
  const start = view.lineBlockAt(startPos);
  const end = view.lineBlockAt(endPos);
  const top = start.top;
  const bottom = end.bottom;
  return { top, height: Math.max(1, bottom - top) };
}

export function logicalFromEditor(
  view: EditorView,
  blocks: AnchorBlock[],
): LogicalPosition | null {
  if (blocks.length === 0) return null;

  const scrollTop = view.scrollDOM.scrollTop;
  const maxScroll = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);

  if (scrollTop <= 0) {
    return { blockId: blocks[0]!.id, relativePosition: 0 };
  }
  if (maxScroll > 0 && scrollTop >= maxScroll - 1) {
    const last = blocks[blocks.length - 1]!;
    return { blockId: last.id, relativePosition: 1 };
  }

  for (const block of blocks) {
    const { top, height } = editorRangeMetrics(view, block.sourceStart, block.sourceEnd);
    if (scrollTop < top + height) {
      const relativePosition = Math.min(1, Math.max(0, (scrollTop - top) / height));
      return { blockId: block.id, relativePosition };
    }
  }

  const last = blocks[blocks.length - 1]!;
  return { blockId: last.id, relativePosition: 1 };
}

export function applyLogicalToEditor(
  view: EditorView,
  blocks: AnchorBlock[],
  logical: LogicalPosition,
): void {
  const block = blocks.find((b) => b.id === logical.blockId) ?? blocks[0];
  if (!block) return;
  const { top, height } = editorRangeMetrics(view, block.sourceStart, block.sourceEnd);
  const next = top + Math.min(1, Math.max(0, logical.relativePosition)) * height;
  const maxScroll = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
  view.scrollDOM.scrollTop = Math.min(maxScroll, Math.max(0, next));
}

export function logicalFromPreview(
  container: HTMLElement,
  blocks: AnchorBlock[],
): LogicalPosition | null {
  if (blocks.length === 0) return null;

  const scrollTop = container.scrollTop;
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);

  if (scrollTop <= 0) {
    return { blockId: blocks[0]!.id, relativePosition: 0 };
  }
  if (maxScroll > 0 && scrollTop >= maxScroll - 1) {
    const last = blocks[blocks.length - 1]!;
    return { blockId: last.id, relativePosition: 1 };
  }

  const nodes = container.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTR}]`);
  for (const node of nodes) {
    const id = node.getAttribute(ANCHOR_ATTR);
    if (!id) continue;
    const top = node.offsetTop;
    const height = Math.max(1, node.offsetHeight);
    if (scrollTop < top + height) {
      const relativePosition = Math.min(1, Math.max(0, (scrollTop - top) / height));
      return { blockId: id, relativePosition };
    }
  }

  const last = blocks[blocks.length - 1]!;
  return { blockId: last.id, relativePosition: 1 };
}

export function applyLogicalToPreview(
  container: HTMLElement,
  logical: LogicalPosition,
): void {
  const node = container.querySelector<HTMLElement>(
    `[${ANCHOR_ATTR}="${CSS.escape(logical.blockId)}"]`,
  );
  if (!node) return;
  const top = node.offsetTop;
  const height = Math.max(1, node.offsetHeight);
  const next = top + Math.min(1, Math.max(0, logical.relativePosition)) * height;
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  container.scrollTop = Math.min(maxScroll, Math.max(0, next));
}
