import type { EditorView } from "@codemirror/view";
import type { FragmentMap } from "../markdown/types";

const EPSILON = 1e-3;

function editorRangeMetrics(
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

export type CenterScrollMap = {
  editorMax: number;
  previewMax: number;
  /** Monotone editor scroll positions. */
  editor: number[];
  /** Matching preview scroll positions (same length). */
  preview: number[];
  toPreview: (editorScrollTop: number) => number;
  toEditor: (previewScrollTop: number) => number;
};

function scrollMax(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function enforceMonotone(values: number[]): void {
  for (let i = 1; i < values.length; i++) {
    if (values[i]! <= values[i - 1]!) {
      values[i] = values[i - 1]! + EPSILON;
    }
  }
}

function lerpLookup(domain: number[], range: number[], x: number): number {
  const n = domain.length;
  if (n === 0) return 0;
  if (n === 1) return range[0]!;
  if (x <= domain[0]!) return range[0]!;
  if (x >= domain[n - 1]!) return range[n - 1]!;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (domain[mid]! <= x) lo = mid;
    else hi = mid;
  }

  const d0 = domain[lo]!;
  const d1 = domain[hi]!;
  const r0 = range[lo]!;
  const r1 = range[hi]!;
  const span = d1 - d0;
  if (span <= EPSILON) return r1;
  const t = (x - d0) / span;
  return r0 + t * (r1 - r0);
}

/**
 * Build a continuous, monotone map between editor and preview scrollTops so
 * that fragment centers stay co-located at each pane's vertical midpoint.
 * Page gaps become speed changes, not discontinuities.
 */
export function buildCenterScrollMap(
  view: EditorView,
  preview: HTMLElement,
  map: FragmentMap,
): CenterScrollMap | null {
  if (map.ordered.length === 0 || map.blocks.length === 0) return null;

  const editorEl = view.scrollDOM;
  const eMax = scrollMax(editorEl);
  const pMax = scrollMax(preview);
  const eHalf = editorEl.clientHeight / 2;
  const pHalf = preview.clientHeight / 2;

  if (eMax <= 0 && pMax <= 0) {
    return {
      editorMax: 0,
      previewMax: 0,
      editor: [0],
      preview: [0],
      toPreview: () => 0,
      toEditor: () => 0,
    };
  }

  const blockById = new Map(map.blocks.map((b) => [b.id, b]));
  const contentHeightByBlock = new Map<string, number>();
  for (const [id, frags] of map.byBlock) {
    contentHeightByBlock.set(
      id,
      Math.max(
        1,
        frags.reduce((sum, f) => sum + f.height, 0),
      ),
    );
  }

  const editorAnchors: number[] = [0];
  const previewAnchors: number[] = [0];

  const beforeByBlock = new Map<string, number>();

  for (const frag of map.ordered) {
    const block = blockById.get(frag.blockId);
    if (!block) continue;

    const { top: blockTop, height: blockHeight } = editorRangeMetrics(
      view,
      block.sourceStart,
      block.sourceEnd,
    );
    const total = contentHeightByBlock.get(frag.blockId) ?? frag.height;
    const before = beforeByBlock.get(frag.blockId) ?? 0;
    const localCenter = before + frag.height / 2;
    beforeByBlock.set(frag.blockId, before + frag.height);

    const rel = Math.min(1, Math.max(0, localCenter / total));
    const e = blockTop + rel * blockHeight - eHalf;
    const p = frag.top + frag.height / 2 - pHalf;

    // Only keep centers that can actually sit on the viewport mid.
    // Endpoints (0,0) and (eMax,pMax) cover the unreachable edges.
    if (e <= 0 || e >= eMax || p <= 0 || p >= pMax) continue;

    editorAnchors.push(e);
    previewAnchors.push(p);
  }

  editorAnchors.push(eMax);
  previewAnchors.push(pMax);

  enforceMonotone(editorAnchors);
  enforceMonotone(previewAnchors);

  // Keep endpoints exact after epsilon pushes on the interior.
  editorAnchors[0] = 0;
  previewAnchors[0] = 0;
  editorAnchors[editorAnchors.length - 1] = eMax;
  previewAnchors[previewAnchors.length - 1] = pMax;
  for (let i = editorAnchors.length - 2; i >= 1; i--) {
    if (editorAnchors[i]! >= editorAnchors[i + 1]!) {
      editorAnchors[i] = editorAnchors[i + 1]! - EPSILON;
    }
    if (previewAnchors[i]! >= previewAnchors[i + 1]!) {
      previewAnchors[i] = previewAnchors[i + 1]! - EPSILON;
    }
  }
  if (editorAnchors.length > 2 && editorAnchors[1]! <= 0) {
    editorAnchors[1] = EPSILON;
  }
  if (previewAnchors.length > 2 && previewAnchors[1]! <= 0) {
    previewAnchors[1] = EPSILON;
  }

  const editor = editorAnchors;
  const previewPts = previewAnchors;

  return {
    editorMax: eMax,
    previewMax: pMax,
    editor,
    preview: previewPts,
    toPreview: (editorScrollTop: number) => {
      const e = clamp(editorScrollTop, 0, eMax);
      if (e <= 0.5) return 0;
      if (e >= eMax - 0.5) return pMax;
      return clamp(lerpLookup(editor, previewPts, e), 0, pMax);
    },
    toEditor: (previewScrollTop: number) => {
      const p = clamp(previewScrollTop, 0, pMax);
      if (p <= 0.5) return 0;
      if (p >= pMax - 0.5) return eMax;
      return clamp(lerpLookup(previewPts, editor, p), 0, eMax);
    },
  };
}
