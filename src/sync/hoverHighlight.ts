import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { AnchorBlock } from "../markdown/types";
import { findBlockBySourcePos } from "../markdown/render";

const ANCHOR_ATTR = "data-vellum-anchor";
const PREVIEW_HOVER_CLASS = "vellum-hover-pair";

const setHoverRange = StateEffect.define<{ from: number; to: number } | null>();

type HoverRange = { from: number; to: number } | null;

function decorationsForRange(
  doc: {
    lineAt: (pos: number) => { number: number; from: number };
    line: (n: number) => { from: number };
  },
  range: { from: number; to: number },
): DecorationSet {
  if (range.to <= range.from) return Decoration.none;
  const start = doc.lineAt(range.from);
  const end = doc.lineAt(Math.max(range.from, range.to - 1));
  const marks = [];
  for (let n = start.number; n <= end.number; n++) {
    marks.push(Decoration.line({ class: "cm-hover-pair" }).range(doc.line(n).from));
  }
  return Decoration.set(marks);
}

const hoverHighlightField = StateField.define<HoverRange>({
  create() {
    return null;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHoverRange)) return effect.value;
    }
    if (value && tr.docChanged) {
      return {
        from: tr.changes.mapPos(value.from, 1),
        to: tr.changes.mapPos(value.to, -1),
      };
    }
    return value;
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => {
      const range = state.field(field);
      if (!range) return Decoration.none;
      return decorationsForRange(state.doc, range);
    }),
});

const hoverHighlightTheme = EditorView.theme({
  ".cm-line.cm-hover-pair": {
    backgroundColor: "rgba(0, 0, 0, 0.04)",
  },
});

/** CodeMirror extension: pair-hover mark decorations. */
export const hoverHighlightExtension = [hoverHighlightField, hoverHighlightTheme];

export function clearEditorHover(view: EditorView): void {
  view.dispatch({ effects: setHoverRange.of(null) });
}

export function setEditorHoverBlock(view: EditorView, block: AnchorBlock | null): void {
  if (!block) {
    clearEditorHover(view);
    return;
  }
  const docLen = view.state.doc.length;
  const from = Math.max(0, Math.min(block.sourceStart, docLen));
  const to = Math.max(from, Math.min(block.sourceEnd, docLen));
  if (to <= from) {
    clearEditorHover(view);
    return;
  }
  view.dispatch({ effects: setHoverRange.of({ from, to }) });
}

export function clearPreviewHover(root: ParentNode): void {
  root.querySelectorAll(`.${PREVIEW_HOVER_CLASS}`).forEach((el) => {
    el.classList.remove(PREVIEW_HOVER_CLASS);
  });
}

export function setPreviewHoverBlock(root: ParentNode, blockId: string | null): void {
  clearPreviewHover(root);
  if (!blockId) return;
  root.querySelectorAll(`[${ANCHOR_ATTR}="${CSS.escape(blockId)}"]`).forEach((el) => {
    el.classList.add(PREVIEW_HOVER_CLASS);
  });
}

export function blockIdFromPreviewTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const host = target.closest(`[${ANCHOR_ATTR}]`);
  if (!host) return null;
  return host.getAttribute(ANCHOR_ATTR);
}

export function blockFromEditorPointer(
  view: EditorView,
  blocks: AnchorBlock[],
  clientX: number,
  clientY: number,
): AnchorBlock | null {
  if (blocks.length === 0) return null;
  const pos = view.posAtCoords({ x: clientX, y: clientY });
  if (pos == null) return null;
  return findBlockBySourcePos(blocks, pos);
}

export type PairHoverController = {
  setBlockId: (blockId: string | null) => void;
  destroy: () => void;
};

function nearestScrollPort(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    const { overflowY } = getComputedStyle(cur);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Bidirectional hover: highlight the same logical block in editor + preview.
 * Re-hit-tests on scroll so the pair stays correct while the pointer is still.
 */
export function attachPairHover(options: {
  view: EditorView;
  previewRoot: HTMLElement;
  getBlocks: () => AnchorBlock[];
}): PairHoverController {
  const { view, previewRoot, getBlocks } = options;
  const previewScroll = nearestScrollPort(previewRoot) ?? previewRoot;
  let currentId: string | null = null;
  let raf = 0;
  let over: "editor" | "preview" | null = null;
  let lastX = 0;
  let lastY = 0;

  const apply = (blockId: string | null) => {
    if (blockId === currentId) return;
    currentId = blockId;
    const blocks = getBlocks();
    const block = blockId ? (blocks.find((b) => b.id === blockId) ?? null) : null;
    setPreviewHoverBlock(previewRoot, block?.id ?? null);
    setEditorHoverBlock(view, block);
  };

  const schedule = (blockId: string | null) => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      apply(blockId);
    });
  };

  const hitTest = () => {
    if (over === "editor") {
      schedule(
        blockFromEditorPointer(view, getBlocks(), lastX, lastY)?.id ?? null,
      );
      return;
    }
    if (over === "preview") {
      const el = document.elementFromPoint(lastX, lastY);
      if (!el || !previewRoot.contains(el)) {
        schedule(null);
        return;
      }
      schedule(blockIdFromPreviewTarget(el));
    }
  };

  const onPreviewMove = (event: PointerEvent) => {
    over = "preview";
    lastX = event.clientX;
    lastY = event.clientY;
    schedule(blockIdFromPreviewTarget(event.target));
  };
  const onPreviewLeave = () => {
    over = null;
    schedule(null);
  };

  const onEditorMove = (event: PointerEvent) => {
    over = "editor";
    lastX = event.clientX;
    lastY = event.clientY;
    schedule(
      blockFromEditorPointer(view, getBlocks(), event.clientX, event.clientY)?.id ??
        null,
    );
  };
  const onEditorLeave = () => {
    over = null;
    schedule(null);
  };

  const onScroll = () => {
    if (over) hitTest();
  };

  previewRoot.addEventListener("pointermove", onPreviewMove);
  previewRoot.addEventListener("pointerleave", onPreviewLeave);
  view.scrollDOM.addEventListener("pointermove", onEditorMove);
  view.scrollDOM.addEventListener("pointerleave", onEditorLeave);
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
  previewScroll.addEventListener("scroll", onScroll, { passive: true });

  return {
    setBlockId: apply,
    destroy: () => {
      if (raf) cancelAnimationFrame(raf);
      previewRoot.removeEventListener("pointermove", onPreviewMove);
      previewRoot.removeEventListener("pointerleave", onPreviewLeave);
      view.scrollDOM.removeEventListener("pointermove", onEditorMove);
      view.scrollDOM.removeEventListener("pointerleave", onEditorLeave);
      view.scrollDOM.removeEventListener("scroll", onScroll);
      previewScroll.removeEventListener("scroll", onScroll);
      apply(null);
    },
  };
}
