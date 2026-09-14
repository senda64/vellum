import { Previewer } from "pagedjs";
import { buildPageCss, type PageSettings } from "../settings";
import katexCss from "katex/dist/katex.min.css?inline";

let activePreviewer: Previewer | null = null;
let stalePreviewer: Previewer | null = null;
let queue: Promise<unknown> = Promise.resolve();
let jobId = 0;

/**
 * Paged.js keeps ResizeObservers on each page after layout. Those fire on
 * scale/clear and call findEndToken → nodeAfter(null) → uncaught TypeError.
 * We only need a static snapshot, so disconnect as soon as preview is done.
 */
function disarmPreviewer(previewer: Previewer): void {
  const pages = previewer.chunker?.pages;
  if (!pages) return;
  for (const page of pages) {
    try {
      page.removeListeners?.();
    } catch {
      // ignore
    }
  }
}

function destroyPreviewer(previewer: Previewer | null): void {
  if (!previewer) return;
  try {
    disarmPreviewer(previewer);
    previewer.polisher.destroy();
  } catch {
    // ignore
  }
}

/**
 * Drop polishers that are no longer backing visible DOM.
 * Call after the new pages have been swapped into view.
 */
export function disposeStalePreviewer(): void {
  if (!stalePreviewer) return;
  destroyPreviewer(stalePreviewer);
  stalePreviewer = null;
}

/**
 * Serialize paged renders into `renderTo` without touching any other DOM.
 * Previous previewer's styles stay until `disposeStalePreviewer()` so the
 * on-screen buffer can keep looking correct until swap.
 */
export function renderPagedPreview(
  html: string,
  settings: PageSettings,
  renderTo: HTMLElement,
): Promise<{ pageCount: number }> {
  const myJob = ++jobId;

  const task = queue.then(async () => {
    // Superseded while waiting in the queue.
    if (myJob !== jobId) return { pageCount: 0 };

    renderTo.replaceChildren();

    const content = document.createElement("div");
    content.className = "vellum-doc";
    content.innerHTML = html;

    const css = buildPageCss(settings);
    const previewer = new Previewer();

    const flow = await previewer.preview(
      content,
      [{ "vellum-page.css": css }, { "katex.css": katexCss }],
      renderTo,
    );

    // A newer job started while we were laying out — discard this result.
    if (myJob !== jobId) {
      destroyPreviewer(previewer);
      renderTo.replaceChildren();
      return { pageCount: 0 };
    }

    disarmPreviewer(previewer);

    // Keep the previous previewer alive until the caller swaps DOM.
    if (activePreviewer && activePreviewer !== previewer) {
      destroyPreviewer(stalePreviewer);
      stalePreviewer = activePreviewer;
    }
    activePreviewer = previewer;

    return {
      pageCount: flow?.total ?? renderTo.querySelectorAll(".pagedjs_page").length,
    };
  });

  queue = task.then(
    () => undefined,
    () => undefined,
  );

  return task;
}

export function destroyPagedPreview(): void {
  jobId += 1;
  destroyPreviewer(stalePreviewer);
  stalePreviewer = null;
  destroyPreviewer(activePreviewer);
  activePreviewer = null;
  document
    .querySelectorAll("style[data-pagedjs-inserted-styles]")
    .forEach((el) => el.remove());
}
