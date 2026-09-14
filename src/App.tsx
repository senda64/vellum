import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import MarkdownEditor from "./components/MarkdownEditor";
import PagePreview, { type PagePreviewHandle } from "./components/PagePreview";
import { openProject, saveMainMarkdown, supportsDirectoryPicker } from "./fs";
import { buildAnchorMap } from "./markdown/render";
import type { FragmentMap } from "./markdown/types";
import { DEFAULT_SETTINGS, parseSettings, type PageSettings } from "./settings";
import {
  logicalFromEditor,
  logicalFromPreview,
  syncEditorFromPreview,
  syncPreviewFromEditor,
} from "./sync/logicalScroll";
import demoMarkdown from "../example/main.md?raw";
import demoSettingsJson from "../example/settings.json";
import "./App.css";

type SaveStatus = "saved" | "unsaved" | null;
type SyncOrigin = "editor" | "preview" | null;

const PREVIEW_DEBOUNCE_MS = 280;

export default function App() {
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const previewHandleRef = useRef<PagePreviewHandle | null>(null);
  const fragmentMapRef = useRef<FragmentMap | null>(null);
  const layoutReadyRef = useRef(false);
  const syncOriginRef = useRef<SyncOrigin>(null);
  const syncUnlockTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingOriginRef = useRef<SyncOrigin>(null);
  const previewTimerRef = useRef<number | null>(null);

  const [content, setContent] = useState("");
  const [previewSource, setPreviewSource] = useState("");
  const [settings, setSettings] = useState<PageSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<SaveStatus>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasFile, setHasFile] = useState(false);
  const [layoutUpdating, setLayoutUpdating] = useState(false);
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

  const runSync = useCallback((origin: Exclude<SyncOrigin, null>) => {
    if (!layoutReadyRef.current) return;
    const view = editorViewRef.current;
    const preview = getPreviewEl();
    const map = fragmentMapRef.current;
    if (!view || !preview || !map || map.ordered.length === 0) return;

    lockSync(origin);
    if (origin === "editor") {
      syncPreviewFromEditor(view, preview, map);
    } else {
      syncEditorFromPreview(view, preview, map);
    }
  }, [getPreviewEl, lockSync]);

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
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") !== "1") return;

    fileHandleRef.current = null;
    setSettings(parseSettings(JSON.stringify(demoSettingsJson)));
    setContent(demoMarkdown);
    setPreviewSource(demoMarkdown);
    setHasFile(true);
    setStatus("saved");
    layoutReadyRef.current = false;
    fragmentMapRef.current = null;
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") !== "1") return;
    const api = {
      ready: () => layoutReadyRef.current,
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
    if (previewTimerRef.current != null) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      setPreviewSource(value);
    }, PREVIEW_DEBOUNCE_MS);
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
    layoutReadyRef.current = false;
    fragmentMapRef.current = null;
    setLayoutUpdating(true);
  }

  function handleLayoutReady(map: FragmentMap) {
    fragmentMapRef.current = map;
    layoutReadyRef.current = map.ordered.length > 0;
    setLayoutUpdating(false);

    const view = editorViewRef.current;
    const preview = getPreviewEl();
    if (view && preview && layoutReadyRef.current) {
      lockSync("editor");
      syncPreviewFromEditor(view, preview, map);
    }
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
            {layoutUpdating && (
              <span className="status-layout">
                {status ? " · " : null}
                Updating layout…
              </span>
            )}
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
          <div className="panes">
            <section className="pane pane-editor" aria-label="Markdown editor">
              <MarkdownEditor
                doc={content}
                onChange={handleChange}
                onScroll={handleEditorScroll}
                onReady={(view) => {
                  editorViewRef.current = view;
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
