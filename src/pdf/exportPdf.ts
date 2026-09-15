import katexCss from "katex/dist/katex.min.css?inline";
import { buildPageCss, pageDimensionsMm, type PageSettings } from "../settings";

export type ExportPdfResult =
  | { ok: true; pageCount: number }
  | { ok: false; reason: "empty" | "error"; message: string };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collectExportStyles(): string {
  const parts: string[] = [];
  for (const style of document.querySelectorAll("style")) {
    const text = style.textContent ?? "";
    if (!text.trim()) continue;
    if (
      style.hasAttribute("data-pagedjs-inserted-styles") ||
      text.includes("@font-face") ||
      text.includes(".katex") ||
      text.includes(".vellum-") ||
      text.includes("pagedjs_") ||
      text.includes("Inter") ||
      text.includes("IBM Plex Mono")
    ) {
      parts.push(`<style>${text}</style>`);
    }
  }
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    if (!link.href) continue;
    parts.push(`<link rel="stylesheet" href="${escapeHtml(link.href)}">`);
  }
  return parts.join("\n");
}

function buildPrintCss(pageWidthMm: number, pageHeightMm: number): string {
  return `
@page {
  size: ${pageWidthMm}mm ${pageHeightMm}mm;
  margin: 0;
}
html, body {
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  font-family: Inter, "Helvetica Neue", Arial, sans-serif;
}
.pagedjs_pages {
  display: block;
  width: ${pageWidthMm}mm;
  margin: 0;
  padding: 0;
}
.pagedjs_page {
  margin: 0 !important;
  box-shadow: none !important;
  break-after: page;
  page-break-after: always;
}
.pagedjs_page:last-child {
  break-after: auto;
  page-break-after: auto;
}
`.trim();
}

async function waitForStylesheets(doc: Document): Promise<void> {
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  await Promise.all(
    links.map(
      (link) =>
        new Promise<void>((resolve) => {
          if (link.sheet) {
            resolve();
            return;
          }
          link.addEventListener("load", () => resolve(), { once: true });
          link.addEventListener("error", () => resolve(), { once: true });
          // Already cached / incomplete events
          window.setTimeout(() => resolve(), 2000);
        }),
    ),
  );
}

async function waitForExportFonts(doc: Document): Promise<void> {
  if (doc.fonts?.ready) {
    await doc.fonts.ready;
  }
  const loads = [
    doc.fonts?.load("400 11pt Inter"),
    doc.fonts?.load("600 18pt Inter"),
    doc.fonts?.load("700 22pt Inter"),
    doc.fonts?.load('400 10pt "IBM Plex Mono"'),
  ].filter(Boolean);
  await Promise.all(loads);
  if (doc.fonts?.ready) {
    await doc.fonts.ready;
  }
}

/**
 * Export the live Paged.js preview through the browser print pipeline.
 * Choose “Save as PDF” in the print dialog. Document fonts are embeddable
 * webfonts (Inter / IBM Plex Mono) so print does not fall back to system-ui.
 */
export async function exportPreviewAsPdf(options: {
  pagesRoot: HTMLElement;
  settings: PageSettings;
  suggestedName?: string;
}): Promise<ExportPdfResult> {
  const pages = options.pagesRoot.querySelector(".pagedjs_pages");
  const pageCount = pages?.querySelectorAll(".pagedjs_page").length ?? 0;
  if (!pages || pageCount === 0) {
    return {
      ok: false,
      reason: "empty",
      message: "Preview has no pages yet. Wait for layout to finish.",
    };
  }

  const { width: pageWidthMm, height: pageHeightMm } = pageDimensionsMm(options.settings);
  const title = (options.suggestedName ?? "vellum.pdf").replace(/\.pdf$/i, "");
  const clone = pages.cloneNode(true) as HTMLElement;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Vellum PDF export");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return { ok: false, reason: "error", message: "Could not open print frame." };
  }

  try {
    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
${collectExportStyles()}
<style>${katexCss}</style>
<style>${buildPageCss(options.settings)}</style>
<style>${buildPrintCss(pageWidthMm, pageHeightMm)}</style>
</head>
<body></body>
</html>`);
    doc.close();

    doc.body.appendChild(doc.importNode(clone, true));

    await waitForStylesheets(doc);
    await waitForExportFonts(doc);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        win.removeEventListener("afterprint", done);
        resolve();
      };
      win.addEventListener("afterprint", done);
      window.setTimeout(done, 120_000);
      win.focus();
      win.print();
    });

    return { ok: true, pageCount };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Failed to export PDF.",
    };
  } finally {
    iframe.remove();
  }
}
