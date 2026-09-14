import type { AnchorBlock, AnchorFragment, FragmentMap } from "../markdown/types";

const ANCHOR_ATTR = "data-vellum-anchor";

export function offsetTopInContainer(el: HTMLElement, container: HTMLElement): number {
  const er = el.getBoundingClientRect();
  const cr = container.getBoundingClientRect();
  return er.top - cr.top + container.scrollTop;
}

export function buildFragmentMap(
  container: HTMLElement,
  blocks: AnchorBlock[],
): FragmentMap {
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTR}]`),
  );

  const ordered: AnchorFragment[] = [];
  const byBlock = new Map<string, AnchorFragment[]>();
  const seen = new Set<string>();

  for (const node of nodes) {
    const blockId = node.getAttribute(ANCHOR_ATTR);
    if (!blockId) continue;

    const page = node.closest(".pagedjs_page");
    const pageIndex = page
      ? Number(page.getAttribute("data-page-number") ?? "1") - 1
      : 0;

    const top = offsetTopInContainer(node, container);
    const height = Math.max(1, node.getBoundingClientRect().height);
    const key = `${blockId}:${pageIndex}:${Math.round(top)}:${Math.round(height)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const fragment: AnchorFragment = { blockId, pageIndex, top, height };
    ordered.push(fragment);

    const list = byBlock.get(blockId) ?? [];
    list.push(fragment);
    byBlock.set(blockId, list);
  }

  ordered.sort((a, b) => a.top - b.top || a.pageIndex - b.pageIndex);

  const firstEnd = findFirstCopyEnd(ordered);
  const trimmed = firstEnd < ordered.length ? ordered.slice(0, firstEnd) : ordered;
  const trimmedByBlock = new Map<string, AnchorFragment[]>();
  for (const frag of trimmed) {
    const list = trimmedByBlock.get(frag.blockId) ?? [];
    list.push(frag);
    trimmedByBlock.set(frag.blockId, list);
  }

  for (const [, list] of trimmedByBlock) {
    list.sort((a, b) => a.top - b.top || a.pageIndex - b.pageIndex);
  }

  for (const block of blocks) {
    if (!trimmedByBlock.has(block.id)) trimmedByBlock.set(block.id, []);
  }

  return { blocks, ordered: trimmed, byBlock: trimmedByBlock };
}

function findFirstCopyEnd(ordered: AnchorFragment[]): number {
  if (ordered.length < 4) return ordered.length;
  let maxPage = -1;
  for (let i = 0; i < ordered.length; i++) {
    const page = ordered[i]!.pageIndex;
    if (page === 0 && maxPage >= 1 && i > ordered.length / 3) {
      return i;
    }
    if (page > maxPage) maxPage = page;
  }
  return ordered.length;
}

function contentHeight(frags: AnchorFragment[]): number {
  return Math.max(
    1,
    frags.reduce((sum, f) => sum + f.height, 0),
  );
}

/**
 * Map logical position → preview content Y using content height only.
 * Page gaps between fragments are skipped (not part of the document).
 */
export function previewYFromLogical(
  map: FragmentMap,
  blockId: string,
  relativePosition: number,
): number | null {
  const frags = map.byBlock.get(blockId) ?? [];
  if (frags.length === 0) return null;

  const rel = Math.min(1, Math.max(0, relativePosition));
  const total = contentHeight(frags);
  let remaining = rel * total;

  for (let i = 0; i < frags.length; i++) {
    const frag = frags[i]!;
    const isLast = i === frags.length - 1;
    if (remaining <= frag.height || isLast) {
      const local = Math.min(frag.height, Math.max(0, remaining));
      return frag.top + local;
    }
    remaining -= frag.height;
  }

  const last = frags[frags.length - 1]!;
  return last.top + last.height;
}

function logicalAtFragmentEdge(
  map: FragmentMap,
  frag: AnchorFragment,
  edge: "start" | "end",
): { blockId: string; relativePosition: number } {
  const frags = map.byBlock.get(frag.blockId) ?? [frag];
  const total = contentHeight(frags);
  let before = 0;
  for (const f of frags) {
    if (f === frag || (f.pageIndex === frag.pageIndex && Math.abs(f.top - frag.top) < 0.5)) {
      const offset = edge === "start" ? before : before + f.height;
      return {
        blockId: frag.blockId,
        relativePosition: Math.min(1, Math.max(0, offset / total)),
      };
    }
    before += f.height;
  }
  return {
    blockId: frag.blockId,
    relativePosition: edge === "start" ? 0 : 1,
  };
}

/**
 * Map preview scroll Y → logical position.
 * Page margins / inter-page gaps are not document content: snap to the
 * preceding fragment end or following fragment start (midpoint).
 */
export function logicalFromPreviewY(
  map: FragmentMap,
  scrollTop: number,
): { blockId: string; relativePosition: number } | null {
  const { blocks, ordered, byBlock } = map;
  if (blocks.length === 0 || ordered.length === 0) return null;

  if (scrollTop <= 0) {
    return { blockId: ordered[0]!.blockId, relativePosition: 0 };
  }

  for (let i = 0; i < ordered.length; i++) {
    const frag = ordered[i]!;
    const bottom = frag.top + frag.height;
    const next = ordered[i + 1];

    if (scrollTop < frag.top) {
      if (i === 0) return { blockId: frag.blockId, relativePosition: 0 };
      const prev = ordered[i - 1]!;
      const gapMid = (prev.top + prev.height + frag.top) / 2;
      if (scrollTop < gapMid) return logicalAtFragmentEdge(map, prev, "end");
      return logicalAtFragmentEdge(map, frag, "start");
    }

    if (scrollTop <= bottom) {
      const frags = byBlock.get(frag.blockId) ?? [frag];
      const total = contentHeight(frags);
      let before = 0;
      for (const f of frags) {
        if (f.pageIndex === frag.pageIndex && Math.abs(f.top - frag.top) < 0.5) {
          const local = scrollTop - frag.top;
          return {
            blockId: frag.blockId,
            relativePosition: Math.min(1, Math.max(0, (before + local) / total)),
          };
        }
        before += f.height;
      }
      return { blockId: frag.blockId, relativePosition: 0 };
    }

    // Past this fragment: if there is a gap before the next, resolve at mid.
    if (next && scrollTop < next.top) {
      const gapMid = (bottom + next.top) / 2;
      if (scrollTop < gapMid) return logicalAtFragmentEdge(map, frag, "end");
      return logicalAtFragmentEdge(map, next, "start");
    }
  }

  const last = ordered[ordered.length - 1]!;
  return logicalAtFragmentEdge(map, last, "end");
}
