import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import MarkdownEditor from "./components/MarkdownEditor";
import PagePreview, { type PagePreviewHandle } from "./components/PagePreview";
import { openProject, saveMainMarkdown, supportsDirectoryPicker } from "./fs";
import { buildAnchorMap } from "./markdown/render";
import type { FragmentMap } from "./markdown/types";
import { exportPreviewAsPdf } from "./pdf/exportPdf";
import { DEFAULT_SETTINGS, parseSettings, type PageSettings } from "./settings";
import { buildCenterScrollMap, type CenterScrollMap } from "./sync/centerMap";
import { attachPairHover, type PairHoverController } from "./sync/hoverHighlight";
import {
  logicalFromEditor,
  logicalFromPreview,
  syncEditorFromPreview,
  syncPreviewFromEditor,
} from "./sync/logicalScroll";
import demoMarkdown from "../example/main.md?raw";
import paperMarkdown from "../example/paper.md?raw";
import demoSettingsJson from "../example/settings.json";
import "./App.css";

type SaveStatus = "saved" | "unsaved" | null;
type SyncOrigin = "editor" | "preview" | null;

const PREVIEW_DEBOUNCE_MS = 90;
/** While typing continuously, still refresh the preview at least this often. */
const PREVIEW_MAX_WAIT_MS = 360;

export default function App() {
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const previewHandleRef = useRef<PagePreviewHandle | null>(null);
  const fragmentMapRef = useRef<FragmentMap | null>(null);
  const centerMapRef = useRef<CenterScrollMap | null>(null);
  const layoutReadyRef = useRef(false);
  const layoutUpdatingRef = useRef(false);
  const syncOriginRef = useRef<SyncOrigin>(null);
  const syncUnlockTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingOriginRef = useRef<SyncOrigin>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewQueuedAtRef = useRef<number | null>(null);
  const panesRef = useRef<HTMLDivElement | null>(null);
  const pairHoverRef = useRef<PairHoverController | null>(null);
  const exportHintTimerRef = useRef<number | null>(null);

  const [content, setContent] = useState("");
  const [previewSource, setPreviewSource] = useState("");
  const [settings, setSettings] = useState<PageSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<SaveStatus>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasFile, setHasFile] = useState(false);
  const [layoutUpdating, setLayoutUpdating] = useState(false);
  const [hoverBindKey, setHoverBindKey] = useState(0);
  const [exportHint, setExportHint] = useState<string | null>(null);
  const supported = supportsDirectoryPicker();

  const anchorMap = useMemo(() => buildAnchorMap(previewSource), [previewSource]);

  const getPreviewEl = useCallback(
    () => previewHandleRef.current?.getScrollEl() ?? null,
    [],
  );

  const lockSync = useCallback((origin: Exclude<SyncOrigin, null>) => {
    syncOriginRef.current = origin;
    if (syncUnlockTimerRef.current != null) {
      window.clearTimeout(syncUnlockTimerRef.current);
    }
    syncUnlockTimerRef.current = window.setTimeout(() => {
      if (syncOriginRef.current === origin) syncOriginRef.current = null;
      syncUnlockTimerRef.current = null;
    }, 160);
  }, []);

  const rebuildCenterMap = useCallback(() => {
    const view = editorViewRef.current;
    const preview = getPreviewEl();
    const fragMap = fragmentMapRef.current;
    if (!view || !preview || !fragMap || fragMap.ordered.length === 0) {
      centerMapRef.current = null;
      return null;
    }
    // Ensure CodeMirror line metrics match the current viewport width.
    view.requestMeasure();
    const next = buildCenterScrollMap(view, preview, fragMap);
    centerMapRef.current = next;
    return next;
  }, [getPreviewEl]);

  const ensureCenterMap = useCallback(() => {
    const view = editorViewRef.current;
    const preview = getPreviewEl();
    const existing = centerMapRef.current;
    if (!view || !preview) return null;

    const eMax = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
    const pMax = Math.max(0, preview.scrollHeight - preview.clientHeight);
    if (
      !existing ||
      Math.abs(existing.editorMax - eMax) > 1 ||
      Math.abs(existing.previewMax - pMax) > 1
    ) {
      return rebuildCenterMap();
    }
    return existing;
  }, [getPreviewEl, rebuildCenterMap]);

  const runSync = useCallback((origin: Exclude<SyncOrigin, null>) => {
    if (!layoutReadyRef.current) return;
    const view = editorViewRef.current;
    const preview = getPreviewEl();
    const scrollMap = ensureCenterMap();
    if (!view || !preview || !scrollMap) return;

    lockSync(origin);
    if (origin === "editor") {
      syncPreviewFromEditor(view, preview, scrollMap);
    } else {
      syncEditorFromPreview(view, preview, scrollMap);
    }
  }, [ensureCenterMap, getPreviewEl, lockSync]);

  const scheduleSync = useCallback(
    (origin: Exclude<SyncOrigin, null>) => {
      if (!layoutReadyRef.current) return;
      if (syncOriginRef.current && syncOriginRef.current !== origin) return;
      pendingOriginRef.current = origin;
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const next = pendingOriginRef.current;
        pendingOriginRef.current = null;
        if (next) runSync(next);
      });
    },
    [runSync],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (previewTimerRef.current != null) window.clearTimeout(previewTimerRef.current);
      if (syncUnlockTimerRef.current != null) window.clearTimeout(syncUnlockTimerRef.current);
      if (exportHintTimerRef.current != null) window.clearTimeout(exportHintTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const demo = params.get("demo");
    if (!demo) return;

    fileHandleRef.current = null;
    setSettings(parseSettings(JSON.stringify(demoSettingsJson)));
    const markdown =
      demo === "paper" || demo === "1" ? paperMarkdown : demoMarkdown;
    setContent(markdown);
    setPreviewSource(markdown);
    setHasFile(true);
    setStatus("saved");
    layoutReadyRef.current = false;
    fragmentMapRef.current = null;
    centerMapRef.current = null;
  }, []);

  useEffect(() => {
    const panes = panesRef.current;
    if (!panes) return;
    let timer: number | null = null;
    const schedule = () => {
      // Preview layout briefly changes metrics; remapping+syncing mid-layout
      // fights scrollTop preserve and makes the scrollbar vibrate.
      if (layoutUpdatingRef.current) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        if (!layoutReadyRef.current || layoutUpdatingRef.current) return;
        rebuildCenterMap();
        runSync("editor");
      }, 80);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(panes);
    const view = editorViewRef.current;
    if (view) ro.observe(view.scrollDOM);
    return () => {
      ro.disconnect();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [hasFile, rebuildCenterMap, runSync]);

  useEffect(() => {
    if (!hasFile || layoutUpdating) return;
    const view = editorViewRef.current;
    const previewRoot = previewHandleRef.current?.getPagesEl() ?? null;
    if (!view || !previewRoot) return;

    pairHoverRef.current?.destroy();
    pairHoverRef.current = attachPairHover({
      view,
      previewRoot,
      getBlocks: () => fragmentMapRef.current?.blocks ?? anchorMap.blocks,
    });

    return () => {
      pairHoverRef.current?.destroy();
      pairHoverRef.current = null;
    };
  }, [hasFile, layoutUpdating, hoverBindKey, anchorMap.blocks]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const demo = params.get("demo");
    if (!demo) return;
    const api = {
      ready: () => layoutReadyRef.current && !!centerMapRef.current,
      getScroll: () => {
        const view = editorViewRef.current;
        const preview = getPreviewEl();
        return {
          editor: view?.scrollDOM.scrollTop ?? null,
          preview: preview?.scrollTop ?? null,
          editorMax: view
            ? Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight)
            : null,
          previewMax: preview
            ? Math.max(0, preview.scrollHeight - preview.clientHeight)
            : null,
          pages: document.querySelectorAll(".pagedjs_page").length,
          roots: document.querySelectorAll(".pagedjs_pages").length,
        };
      },
      getLogical: () => {
        const view = editorViewRef.current;
        const preview = getPreviewEl();
        const map = fragmentMapRef.current;
        if (!view || !preview || !map) return null;
        return {
          fromEditor: logicalFromEditor(view, map.blocks),
          fromPreview: logicalFromPreview(preview, map),
          fragCount: map.ordered.length,
        };
      },
      getCenterMap: () => {
        const m = centerMapRef.current;
        if (!m) return null;
        return {
          editorMax: m.editorMax,
          previewMax: m.previewMax,
          anchors: m.editor.length,
        };
      },
      scrollEditor: (y: number) => {
        const view = editorViewRef.current;
        if (!view) return;
        view.scrollDOM.scrollTop = y;
        view.scrollDOM.dispatchEvent(new Event("scroll"));
      },
      scrollPreview: (y: number) => {
        const preview = getPreviewEl();
        if (!preview) return;
        preview.scrollTop = y;
        preview.dispatchEvent(new Event("scroll"));
      },
    };
    (window as unknown as { __vellum: typeof api }).__vellum = api;
  }, [getPreviewEl]);

  function handleEditorScroll() {
    if (syncOriginRef.current === "preview") return;
    scheduleSync("editor");
  }

  function queuePreviewUpdate(value: string) {
    const now = performance.now();
    if (previewQueuedAtRef.current == null) previewQueuedAtRef.current = now;

    if (previewTimerRef.current != null) window.clearTimeout(previewTimerRef.current);

    const waited = now - previewQueuedAtRef.current;
    // Flush immediately if we've already deferred for MAX_WAIT; otherwise debounce keystrokes.
    const waitMs = waited >= PREVIEW_MAX_WAIT_MS ? 0 : PREVIEW_DEBOUNCE_MS;

    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      previewQueuedAtRef.current = null;
      setPreviewSource(value);
    }, waitMs);
  }

  async function handleOpen() {
    setError(null);
    setBusy(true);
    try {
      const result = await openProject();
      if (!result.ok) {
        if (result.reason !== "cancelled") setError(result.message);
        return;
      }
      fileHandleRef.current = result.fileHandle;
      setSettings(result.settings);
      setContent(result.content);
      setPreviewSource(result.content);
      setHasFile(true);
      setStatus("saved");
      layoutReadyRef.current = false;
      fragmentMapRef.current = null;
      centerMapRef.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    const handle = fileHandleRef.current;
    if (!handle) return;
    setError(null);
    setBusy(true);
    try {
      const result = await saveMainMarkdown(handle, content);
      if (!result.ok) {
        if (result.reason !== "cancelled") setError(result.message);
        return;
      }
      setStatus("saved");
    } finally {
      setBusy(false);
    }
  }

  function showExportHint(message: string) {
    setExportHint(message);
    if (exportHintTimerRef.current != null) window.clearTimeout(exportHintTimerRef.current);
    exportHintTimerRef.current = window.setTimeout(() => {
      exportHintTimerRef.current = null;
      setExportHint(null);
    }, 1600);
  }

  async function handleExportPdf() {
    if (layoutUpdating) {
      showExportHint("Preview is updating…");
      return;
    }

    const pagesRoot = previewHandleRef.current?.getPagesEl() ?? null;
    if (!pagesRoot) {
      showExportHint("Preview is not ready…");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const slug = (titleMatch?.[1] ?? "vellum")
        .trim()
        .replace(/[^\w\u3040-\u30ff\u3400-\u9fff\- ]+/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 60);
      const result = await exportPreviewAsPdf({
        pagesRoot,
        settings,
        suggestedName: `${slug || "vellum"}.pdf`,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  function handleChange(value: string) {
    setContent(value);
    if (hasFile) setStatus("unsaved");
    queuePreviewUpdate(value);
  }

  function handlePreviewScroll() {
    if (syncOriginRef.current === "editor") return;
    scheduleSync("preview");
  }

  function handleLayoutStart() {
    // Keep the previous fragment map and sync active until the new layout
    // swaps in — avoids blank preview and sync dead-zones while paging.
    layoutUpdatingRef.current = true;
    setLayoutUpdating(true);
  }

  function handleLayoutReady(map: FragmentMap) {
    if (map.ordered.length > 0) {
      fragmentMapRef.current = map;
      layoutReadyRef.current = true;
      rebuildCenterMap();
    }
    layoutUpdatingRef.current = false;
    setLayoutUpdating(false);
    setHoverBindKey((n) => n + 1);

    // Do not force preview scroll here — remapping on every keystroke made the
    // scrollbar jump. Keep the preserved offset; the next user scroll re-syncs.
    requestAnimationFrame(() => {
      rebuildCenterMap();
    });
  }

  return (
    <div className="page">
      <header className="toolbar">
        <p className="brand">Vellum</p>
        <div className="toolbar-end">
          <span
            className="status"
            data-state={status ?? "idle"}
            aria-live="polite"
          >
            {status === "saved" && "Saved"}
            {status === "unsaved" && "Unsaved changes"}
          </span>
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={handleOpen}
              disabled={busy || !supported}
            >
              Open Folder
            </button>
            <button
              type="button"
              className="ghost"
              onClick={handleSave}
              disabled={busy || !hasFile || status !== "unsaved"}
            >
              Save
            </button>
            <div className="export-wrap">
              <button
                type="button"
                className="ghost"
                onClick={handleExportPdf}
                disabled={busy || !hasFile}
              >
                Export PDF
              </button>
              {exportHint && (
                <p className="export-hint" role="status">
                  {exportHint}
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="workspace">
        {!supported && (
          <p className="notice" role="alert">
            File System Access API is required. Open this page in Chrome or Edge.
          </p>
        )}
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}

        {hasFile ? (
          <div className="panes" ref={panesRef}>
            <section className="pane pane-editor" aria-label="Markdown editor">
              <MarkdownEditor
                doc={content}
                onChange={handleChange}
                onScroll={handleEditorScroll}
                onReady={(view) => {
                  editorViewRef.current = view;
                  setHoverBindKey((n) => n + 1);
                  if (layoutReadyRef.current && fragmentMapRef.current) {
                    rebuildCenterMap();
                    runSync("editor");
                  }
                }}
              />
            </section>
            <section className="pane pane-preview" aria-label="Page preview">
              <PagePreview
                ref={previewHandleRef}
                html={anchorMap.html}
                blocks={anchorMap.blocks}
                settings={settings}
                onScroll={handlePreviewScroll}
                onLayoutStart={handleLayoutStart}
                onLayoutReady={handleLayoutReady}
              />
            </section>
          </div>
        ) : (
          <div className="empty">
            <h1>Open a local folder to begin.</h1>
            <p className="lede">
              Choose a project folder that contains <code>main.md</code>. Optional{" "}
              <code>settings.json</code> controls paper size and margins. Preview shows
              paginated sheets on the right.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
