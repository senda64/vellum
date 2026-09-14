import { Previewer } from "pagedjs";
import { buildPageCss, type PageSettings } from "../settings";

let activePreviewer: Previewer | null = null;
let queue: Promise<unknown> = Promise.resolve();

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

function cleanupPreviewer(): void {
  if (activePreviewer) {
    try {
      disarmPreviewer(activePreviewer);
      activePreviewer.polisher.destroy();
    } catch {
      // ignore cleanup errors
    }
    activePreviewer = null;
  }
  document
    .querySelectorAll("style[data-pagedjs-inserted-styles]")
    .forEach((el) => el.remove());
}

/**
 * Serialize paged renders. Concurrent Previewer.preview() calls (e.g. React
 * StrictMode double-mount) otherwise append duplicate .pagedjs_pages trees.
 */
export function renderPagedPreview(
  html: string,
  settings: PageSettings,
  renderTo: HTMLElement,
): Promise<{ pageCount: number }> {
  const task = queue.then(async () => {
    cleanupPreviewer();
    renderTo.replaceChildren();

    const content = document.createElement("div");
    content.className = "vellum-doc";
    content.innerHTML = html;

    const css = buildPageCss(settings);
    const previewer = new Previewer();
    activePreviewer = previewer;

    const flow = await previewer.preview(
      content,
      [{ "vellum-page.css": css }],
      renderTo,
    );

    // Guard against a stale previewer finishing after a newer clear.
    if (activePreviewer !== previewer) {
      try {
        disarmPreviewer(previewer);
      } catch {
        // ignore
      }
      return { pageCount: 0 };
    }

    disarmPreviewer(previewer);

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
  cleanupPreviewer();
}
