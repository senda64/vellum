import type { EditorView } from "@codemirror/view";
import type { AnchorBlock, FragmentMap, LogicalPosition } from "../markdown/types";
import {
  collapsedOffsetFromLogical,
  logicalFromCollapsedOffset,
  totalContentHeight,
} from "../paged/fragments";

/** Ease only the leading page margin into the first block (editor → preview). */
const TOP_EDGE_PX = 96;

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
  const pMax = scrollMax(container);
  if (pMax <= 0) {
    return { blockId: map.blocks[0]!.id, relativePosition: 0 };
  }
  return logicalFromCollapsedOffset(
    map,
    (container.scrollTop / pMax) * totalContentHeight(map),
  );
}

export function applyLogicalToPreview(
  container: HTMLElement,
  map: FragmentMap | null,
  logical: LogicalPosition,
): void {
  if (!map) return;
  const offset = collapsedOffsetFromLogical(
    map,
    logical.blockId,
    logical.relativePosition,
  );
  if (offset == null) return;
  const pMax = scrollMax(container);
  const total = totalContentHeight(map);
  const next = Math.min(pMax, Math.max(0, (offset / total) * pMax));
  if (Math.abs(container.scrollTop - next) < 0.5) return;
  container.scrollTop = next;
}

/**
 * Editor → Preview via gap-collapsed content progress.
 */
export function syncPreviewFromEditor(
  view: EditorView,
  preview: HTMLElement,
  map: FragmentMap,
): void {
  const eTop = view.scrollDOM.scrollTop;
  const eMax = scrollMax(view.scrollDOM);
  const pMax = scrollMax(preview);

  if (eMax <= 0 || pMax <= 0) {
    preview.scrollTop = 0;
    return;
  }
  if (eTop <= 0) {
    preview.scrollTop = 0;
    return;
  }
  if (eTop >= eMax) {
    preview.scrollTop = pMax;
    return;
  }

  const logical = logicalFromEditor(view, map.blocks);
  if (!logical) return;
  const offset = collapsedOffsetFromLogical(
    map,
    logical.blockId,
    logical.relativePosition,
  );
  if (offset == null) return;

  const total = totalContentHeight(map);
  let y = (offset / total) * pMax;

  const topEdge = Math.min(TOP_EDGE_PX, eMax * 0.2);
  if (eTop < topEdge) {
    y = (eTop / topEdge) * y;
  }

  if (Math.abs(preview.scrollTop - y) < 0.5) return;
  preview.scrollTop = Math.min(pMax, Math.max(0, y));
}

/**
 * Preview → Editor: exact inverse of collapsed E→P mapping.
 * Same coordinate system as editor→preview to avoid mode-switch flicker.
 */
export function syncEditorFromPreview(
  view: EditorView,
  preview: HTMLElement,
  map: FragmentMap,
): void {
  const pTop = preview.scrollTop;
  const pMax = scrollMax(preview);
  const eMax = scrollMax(view.scrollDOM);

  if (eMax <= 0 || pMax <= 0) {
    view.scrollDOM.scrollTop = 0;
    return;
  }
  if (pTop <= 0) {
    if (view.scrollDOM.scrollTop !== 0) view.scrollDOM.scrollTop = 0;
    return;
  }
  if (pTop >= pMax) {
    if (Math.abs(view.scrollDOM.scrollTop - eMax) >= 0.5) {
      view.scrollDOM.scrollTop = eMax;
    }
    return;
  }

  const logical = logicalFromCollapsedOffset(
    map,
    (pTop / pMax) * totalContentHeight(map),
  );
  if (!logical) return;

  const block = map.blocks.find((b) => b.id === logical.blockId) ?? map.blocks[0];
  if (!block) return;
  const { top, height } = editorRangeMetrics(view, block.sourceStart, block.sourceEnd);
  const next = top + Math.min(1, Math.max(0, logical.relativePosition)) * height;
  const clamped = Math.min(eMax, Math.max(0, next));
  if (Math.abs(view.scrollDOM.scrollTop - clamped) < 0.5) return;
  view.scrollDOM.scrollTop = clamped;
}
