export type PageSizeName = "A4" | "A5" | "Letter";
export type PageOrientation = "portrait" | "landscape";

export type PageMargins = {
  top: string;
  right: string;
  bottom: string;
  left: string;
};

export type PageSettings = {
  page: {
    size: PageSizeName;
    orientation: PageOrientation;
    margin: PageMargins;
  };
};

export const DEFAULT_SETTINGS: PageSettings = {
  page: {
    size: "A4",
    orientation: "portrait",
    margin: {
      top: "20mm",
      right: "20mm",
      bottom: "20mm",
      left: "20mm",
    },
  },
};

const PAGE_SIZES_MM: Record<PageSizeName, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
};

const SIZE_NAMES = new Set<string>(["A4", "A5", "Letter"]);

function isMarginString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseSettings(raw: string): PageSettings {
  try {
    const data = JSON.parse(raw) as {
      page?: {
        size?: unknown;
        orientation?: unknown;
        margin?: Partial<PageMargins>;
      };
    };
    const page = data.page ?? {};
    const size = SIZE_NAMES.has(String(page.size))
      ? (page.size as PageSizeName)
      : DEFAULT_SETTINGS.page.size;
    const orientation =
      page.orientation === "landscape" || page.orientation === "portrait"
        ? page.orientation
        : DEFAULT_SETTINGS.page.orientation;
    const marginIn = page.margin ?? {};
    const margin: PageMargins = {
      top: isMarginString(marginIn.top) ? marginIn.top : DEFAULT_SETTINGS.page.margin.top,
      right: isMarginString(marginIn.right) ? marginIn.right : DEFAULT_SETTINGS.page.margin.right,
      bottom: isMarginString(marginIn.bottom)
        ? marginIn.bottom
        : DEFAULT_SETTINGS.page.margin.bottom,
      left: isMarginString(marginIn.left) ? marginIn.left : DEFAULT_SETTINGS.page.margin.left,
    };
    return { page: { size, orientation, margin } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function pageDimensionsMm(settings: PageSettings): { width: number; height: number } {
  const base = PAGE_SIZES_MM[settings.page.size];
  if (settings.page.orientation === "landscape") {
    return { width: base.height, height: base.width };
  }
  return { width: base.width, height: base.height };
}

export function buildPageCss(settings: PageSettings): string {
  const { margin } = settings.page;
  const { width, height } = pageDimensionsMm(settings);
  return `
@page {
  size: ${width}mm ${height}mm;
  margin: ${margin.top} ${margin.right} ${margin.bottom} ${margin.left};
}

.vellum-doc {
  color: #111;
  font-family: Inter, "Helvetica Neue", Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.55;
}

.vellum-block {
  margin: 0 0 0.85em;
}

.vellum-block:last-child {
  margin-bottom: 0;
}

.vellum-doc h1,
.vellum-doc h2,
.vellum-doc h3,
.vellum-doc h4,
.vellum-doc h5,
.vellum-doc h6 {
  margin: 0 0 0.4em;
  font-weight: 600;
  line-height: 1.25;
  break-after: avoid;
  page-break-after: avoid;
}

.vellum-doc h1 { font-size: 1.7em; }
.vellum-doc h2 { font-size: 1.35em; }
.vellum-doc h3 { font-size: 1.15em; }

.vellum-doc p { margin: 0; }

.vellum-doc ul,
.vellum-doc ol {
  margin: 0;
  padding-left: 1.35em;
}

.vellum-doc li + li { margin-top: 0.15em; }

.vellum-doc blockquote {
  margin: 0;
  padding-left: 0.9em;
  border-left: 3px solid #ccc;
  color: #444;
}

.vellum-doc pre {
  margin: 0;
  padding: 0.7em 0.85em;
  overflow: hidden;
  background: #f5f5f5;
  font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  font-size: 0.85em;
  line-height: 1.45;
  white-space: pre-wrap;
}

.vellum-doc code {
  font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  font-size: 0.9em;
}

.vellum-doc :not(pre) > code {
  padding: 0.05em 0.25em;
  background: #f0f0f0;
}

.vellum-doc hr {
  border: 0;
  border-top: 1px solid #ccc;
  margin: 0.6em 0;
}

.vellum-doc table {
  border-collapse: collapse;
  width: 100%;
  margin: 0;
  font-size: 0.95em;
  break-inside: avoid;
  page-break-inside: avoid;
}

.vellum-doc th,
.vellum-doc td {
  border: 1px solid #ccc;
  padding: 0.35em 0.55em;
  text-align: left;
  vertical-align: top;
}

.vellum-doc th {
  background: #f5f5f5;
  font-weight: 600;
}

.vellum-doc del,
.vellum-doc s {
  text-decoration: line-through;
  color: #555;
}

.vellum-doc .task-list-item {
  list-style: none;
  margin-left: -1.35em;
  padding-left: 0;
}

.vellum-doc .task-list-item input[type="checkbox"] {
  margin: 0 0.45em 0 0;
  vertical-align: middle;
}

.vellum-doc ul.contains-task-list {
  padding-left: 1.35em;
}

.vellum-doc .katex-display {
  margin: 0.6em 0;
  overflow-x: auto;
  overflow-y: hidden;
  break-inside: avoid;
  page-break-inside: avoid;
}

.vellum-doc .katex {
  font-size: 1.05em;
}

.vellum-empty {
  min-height: 1em;
}
`.trim();
}
