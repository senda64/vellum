import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { AnchorBlock, FragmentMap } from "../markdown/types";
import { buildFragmentMap } from "../paged/fragments";
import {
  destroyPagedPreview,
  disposeStalePreviewer,
  renderPagedPreview,
} from "../paged/layout";
import { pageDimensionsMm, type PageSettings } from "../settings";

export type PagePreviewHandle = {
  getScrollEl: () => HTMLDivElement | null;
  /** Visible Paged.js mount (unscaled page boxes live under `.pages-stage`). */
  getPagesEl: () => HTMLDivElement | null;
};

type Props = {
  html: string;
  blocks: AnchorBlock[];
  settings: PageSettings;
  onScroll?: () => void;
  onLayoutStart?: () => void;
  onLayoutReady?: (map: FragmentMap) => void;
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

const PagePreview = forwardRef<PagePreviewHandle, Props>(function PagePreview(
  { html, blocks, settings, onScroll, onLayoutStart, onLayoutReady },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef<HTMLDivElement | null>(null);
  const bufferRef = useRef<HTMLDivElement | null>(null);
  const generationRef = useRef(0);
  const scaleRef = useRef(1);
  const onScrollRef = useRef(onScroll);
  const onLayoutStartRef = useRef(onLayoutStart);
  const onLayoutReadyRef = useRef(onLayoutReady);
  const blocksRef = useRef(blocks);
  const hasVisibleRef = useRef(false);
  const suppressScrollRef = useRef(false);

  onScrollRef.current = onScroll;
  onLayoutStartRef.current = onLayoutStart;
  onLayoutReadyRef.current = onLayoutReady;
  blocksRef.current = blocks;

  const [scale, setScale] = useState(1);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [layoutError, setLayoutError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    getScrollEl: () => scrollRef.current,
    getPagesEl: () => visibleRef.current,
  }));

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handle = () => {
      if (suppressScrollRef.current) return;
      onScrollRef.current?.();
    };
    el.addEventListener("scroll", handle, { passive: true });
    return () => el.removeEventListener("scroll", handle);
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    const buffer = bufferRef.current;
    const visible = visibleRef.current;
    const stage = stageRef.current;
    const scroll = scrollRef.current;
    if (!buffer || !visible || !stage || !scroll) return;

    let cancelled = false;
    onLayoutStartRef.current?.();
    setLayoutError(null);

    // Keep the on-screen stage as-is (no clear / no unscale) while we layout
    // into the offscreen buffer, then swap atomically.
    (async () => {
      try {
        // Absolute offscreen buffer collapses to 0×0 without an explicit width;
        // Paged.js then hangs or emits empty pages and blocks the layout queue.
        if (buffer.getBoundingClientRect().width < 1) {
          await nextFrame();
          if (cancelled || generation !== generationRef.current) return;
          if (buffer.getBoundingClientRect().width < 1) {
            throw new Error("Preview layout buffer has no width.");
          }
        }

        await renderPagedPreview(html, settings, buffer);
        if (cancelled || generation !== generationRef.current) return;

        const pageRoots = buffer.querySelectorAll(".pagedjs_pages");
        if (pageRoots.length > 1) {
          pageRoots.forEach((node, index) => {
            if (index < pageRoots.length - 1) node.remove();
          });
        }

        await nextFrame();
        if (cancelled || generation !== generationRef.current) return;

        const width = Math.max(buffer.scrollWidth, buffer.offsetWidth);
        const height = Math.max(buffer.scrollHeight, buffer.offsetHeight);
        if (width <= 0 || height <= 0) {
          // Empty / failed buffer — leave the previous preview on screen.
          onLayoutReadyRef.current?.({
            blocks: blocksRef.current,
            ordered: [],
            byBlock: new Map(),
          });
          return;
        }

        const available = Math.max(120, scroll.clientWidth - 48);
        const nextScale = Math.min(1, available / Math.max(1, width));
        const prevScrollTop = scroll.scrollTop;

        // Atomic swap: move new pages into the visible root.
        visible.replaceChildren(...Array.from(buffer.childNodes));
        buffer.replaceChildren();
        hasVisibleRef.current = visible.childNodes.length > 0;

        scaleRef.current = nextScale;
        stage.style.width = `${width}px`;
        stage.style.transform = `scale(${nextScale})`;
        stage.style.transformOrigin = "top left";

        // Apply sizer size synchronously so scrollHeight is correct before we
        // touch scrollTop (React state update alone would lag a frame and jump).
        const scaledH = height * nextScale;
        const scaledW = width * nextScale;
        const sizer = scroll.querySelector(".pages-sizer");
        const clip = scroll.querySelector(".pages-clip");
        if (sizer instanceof HTMLElement) sizer.style.height = `${scaledH}px`;
        if (clip instanceof HTMLElement) {
          clip.style.width = `${scaledW}px`;
          clip.style.height = `${scaledH}px`;
        }

        setStageSize({ width, height });
        setScale(nextScale);

        // Drop previous paged.js styles only after the new pages are visible.
        disposeStalePreviewer();

        // Keep the same absolute scroll offset (clamped). Ratio restore + later
        // editor sync was fighting and made the scrollbar jump on each keystroke.
        const nextMax = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
        const nextScrollTop = Math.min(prevScrollTop, nextMax);
        if (Math.abs(scroll.scrollTop - nextScrollTop) > 0.5) {
          suppressScrollRef.current = true;
          scroll.scrollTop = nextScrollTop;
          requestAnimationFrame(() => {
            suppressScrollRef.current = false;
          });
        }

        await nextFrame();
        if (cancelled || generation !== generationRef.current) return;

        const map = buildFragmentMap(scroll, blocksRef.current);
        onLayoutReadyRef.current?.(map);
      } catch (err) {
        if (cancelled || generation !== generationRef.current) return;
        setLayoutError(err instanceof Error ? err.message : "Page layout failed.");
        if (!hasVisibleRef.current) {
          onLayoutReadyRef.current?.({
            blocks: blocksRef.current,
            ordered: [],
            byBlock: new Map(),
          });
        } else {
          // Keep previous preview; clear "updating" via a map rebuild.
          const map = buildFragmentMap(scroll, blocksRef.current);
          onLayoutReadyRef.current?.(map);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [html, settings]);

  useEffect(() => {
    return () => destroyPagedPreview();
  }, []);

  useEffect(() => {
    const scroll = scrollRef.current;
    const stage = stageRef.current;
    if (!scroll || !stage || stageSize.width === 0) return;

    const applyScale = () => {
      const available = Math.max(120, scroll.clientWidth - 48);
      const next = Math.min(1, available / Math.max(1, stageSize.width));
      if (Math.abs(scaleRef.current - next) < 0.001) return;

      scaleRef.current = next;
      stage.style.transform = `scale(${next})`;
      setScale(next);

      requestAnimationFrame(() => {
        const map = buildFragmentMap(scroll, blocksRef.current);
        if (map.ordered.length > 0) onLayoutReadyRef.current?.(map);
      });
    };

    const ro = new ResizeObserver(applyScale);
    ro.observe(scroll);
    return () => ro.disconnect();
  }, [stageSize.width]);

  const scaledHeight = stageSize.height * scale;
  const scaledWidth = stageSize.width * scale;
  const pageMm = pageDimensionsMm(settings);

  return (
    <div className="preview-root">
      <div className="preview-scroll" ref={scrollRef}>
        {layoutError && (
          <p className="notice notice-error" role="alert">
            {layoutError}
          </p>
        )}
        <div
          className="pages-sizer"
          style={{ height: stageSize.height ? scaledHeight : undefined }}
        >
          <div
            className="pages-clip"
            style={{
              width: stageSize.width ? scaledWidth : undefined,
              height: stageSize.height ? scaledHeight : undefined,
            }}
          >
            <div className="pages-stage" ref={stageRef}>
              <div className="pages-render" ref={visibleRef} />
            </div>
          </div>
        </div>
      </div>
      {/* Offscreen layout target — MUST stay outside .preview-scroll.
          Absolute children still expand a scrollport's scrollHeight.
          Needs an explicit width; otherwise the box collapses to 0 and
          Paged.js emits empty pages. */}
      <div
        className="pages-render pages-render-buffer"
        ref={bufferRef}
        aria-hidden="true"
        style={{ width: `${pageMm.width}mm` }}
      />
    </div>
  );
});

export default PagePreview;
