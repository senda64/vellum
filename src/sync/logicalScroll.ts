import type { EditorView } from "@codemirror/view";
import type { AnchorBlock, FragmentMap, LogicalPosition } from "../markdown/types";
import { logicalFromPreviewY, previewYFromLogical } from "../paged/fragments";
import type { CenterScrollMap } from "./centerMap";

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
  return { top: start.top, height: Math.max(1, end.bottom - start.top) };
}

function scrollMax(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight);
}

export function logicalFromEditor(
  view: EditorView,
  blocks: AnchorBlock[],
): LogicalPosition | null {
  if (blocks.length === 0) return null;

  const scrollTop = view.scrollDOM.scrollTop;

  if (scrollTop <= 0) {
    return { blockId: blocks[0]!.id, relativePosition: 0 };
  }

  let prevBottom = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const { top, height } = editorRangeMetrics(view, block.sourceStart, block.sourceEnd);
    const bottom = top + height;

    if (scrollTop < top) {
      if (i === 0) return { blockId: block.id, relativePosition: 0 };
      const prev = blocks[i - 1]!;
      const mid = (prevBottom + top) / 2;
      if (scrollTop < mid) return { blockId: prev.id, relativePosition: 1 };
      return { blockId: block.id, relativePosition: 0 };
    }

    if (scrollTop <= bottom) {
      return {
        blockId: block.id,
        relativePosition: Math.min(1, Math.max(0, (scrollTop - top) / height)),
      };
    }
    prevBottom = bottom;
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
  const maxScroll = scrollMax(view.scrollDOM);
  const clamped = Math.min(maxScroll, Math.max(0, next));
  if (Math.abs(view.scrollDOM.scrollTop - clamped) < 0.5) return;
  view.scrollDOM.scrollTop = clamped;
}

export function logicalFromPreview(
  container: HTMLElement,
  map: FragmentMap | null,
): LogicalPosition | null {
  if (!map || map.ordered.length === 0) return null;
  return logicalFromPreviewY(map, container.scrollTop);
}

export function applyLogicalToPreview(
  container: HTMLElement,
  map: FragmentMap | null,
  logical: LogicalPosition,
): void {
  if (!map) return;
  const y = previewYFromLogical(map, logical.blockId, logical.relativePosition);
  if (y == null) return;
  const maxScroll = scrollMax(container);
  const next = Math.min(maxScroll, Math.max(0, y));
  if (Math.abs(container.scrollTop - next) < 0.5) return;
  container.scrollTop = next;
}

/**
 * Editor → Preview via continuous center-anchor map (variable speed, no jumps).
 */
export function syncPreviewFromEditor(
  view: EditorView,
  preview: HTMLElement,
  scrollMap: CenterScrollMap,
): void {
  const next = scrollMap.toPreview(view.scrollDOM.scrollTop);
  if (Math.abs(preview.scrollTop - next) < 0.5) return;
  preview.scrollTop = next;
}

/**
 * Preview → Editor via the inverse center-anchor map.
 */
export function syncEditorFromPreview(
  view: EditorView,
  preview: HTMLElement,
  scrollMap: CenterScrollMap,
): void {
  const next = scrollMap.toEditor(preview.scrollTop);
  if (Math.abs(view.scrollDOM.scrollTop - next) < 0.5) return;
  view.scrollDOM.scrollTop = next;
}
