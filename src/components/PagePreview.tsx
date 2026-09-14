import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { AnchorBlock, FragmentMap } from "../markdown/types";
import { buildFragmentMap } from "../paged/fragments";
import { destroyPagedPreview, renderPagedPreview } from "../paged/layout";
import type { PageSettings } from "../settings";

export type PagePreviewHandle = {
  getScrollEl: () => HTMLDivElement | null;
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
  const renderRef = useRef<HTMLDivElement | null>(null);
  const generationRef = useRef(0);
  const scaleRef = useRef(1);
  const onScrollRef = useRef(onScroll);
  const onLayoutStartRef = useRef(onLayoutStart);
  const onLayoutReadyRef = useRef(onLayoutReady);
  const blocksRef = useRef(blocks);

  onScrollRef.current = onScroll;
  onLayoutStartRef.current = onLayoutStart;
  onLayoutReadyRef.current = onLayoutReady;
  blocksRef.current = blocks;

  const [scale, setScale] = useState(1);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [layoutError, setLayoutError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    getScrollEl: () => scrollRef.current,
  }));

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handle = () => onScrollRef.current?.();
    el.addEventListener("scroll", handle, { passive: true });
    return () => el.removeEventListener("scroll", handle);
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    const renderTo = renderRef.current;
    const stage = stageRef.current;
    const scroll = scrollRef.current;
    if (!renderTo || !stage || !scroll) return;

    let cancelled = false;
    onLayoutStartRef.current?.();
    setLayoutError(null);

    // Layout must run at scale=1; React state updates are async, so force DOM now.
    scaleRef.current = 1;
    stage.style.transform = "none";
    stage.style.width = "auto";

    (async () => {
      try {
        await renderPagedPreview(html, settings, renderTo);
        if (cancelled || generation !== generationRef.current) return;

        // Defense: concurrent layouts can leave duplicate page trees.
        const pageRoots = renderTo.querySelectorAll(".pagedjs_pages");
        if (pageRoots.length > 1) {
          pageRoots.forEach((node, index) => {
            if (index < pageRoots.length - 1) node.remove();
          });
        }

        await nextFrame();

        const width = Math.max(renderTo.scrollWidth, renderTo.offsetWidth);
        const height = Math.max(renderTo.scrollHeight, renderTo.offsetHeight);
        const available = Math.max(120, scroll.clientWidth - 48);
        const nextScale = Math.min(1, available / Math.max(1, width));

        scaleRef.current = nextScale;
        stage.style.width = `${width}px`;
        stage.style.transform = `scale(${nextScale})`;
        stage.style.transformOrigin = "top left";

        setStageSize({ width, height });
        setScale(nextScale);

        await nextFrame();
        await nextFrame();
        if (cancelled || generation !== generationRef.current) return;

        const map = buildFragmentMap(scroll, blocksRef.current);
        onLayoutReadyRef.current?.(map);
      } catch (err) {
        if (cancelled || generation !== generationRef.current) return;
        setLayoutError(err instanceof Error ? err.message : "Page layout failed.");
        onLayoutReadyRef.current?.({
          blocks: blocksRef.current,
          ordered: [],
          byBlock: new Map(),
        });
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

  return (
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
            <div className="pages-render" ref={renderRef} />
          </div>
        </div>
      </div>
    </div>
  );
});

export default PagePreview;
