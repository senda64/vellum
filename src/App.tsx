import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import MarkdownEditor from "./components/MarkdownEditor";
import MarkdownPreview from "./components/MarkdownPreview";
import { openMainMarkdown, saveMainMarkdown, supportsDirectoryPicker } from "./fs";
import { buildAnchorMap } from "./markdown/render";
import type { AnchorBlock } from "./markdown/types";
import {
  applyLogicalToEditor,
  applyLogicalToPreview,
  logicalFromEditor,
  logicalFromPreview,
} from "./sync/logicalScroll";
import "./App.css";

type SaveStatus = "saved" | "unsaved" | null;
type SyncOrigin = "editor" | "preview" | null;

const PREVIEW_DEBOUNCE_MS = 120;

export default function App() {
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const blocksRef = useRef<AnchorBlock[]>([]);
  const syncOriginRef = useRef<SyncOrigin>(null);
  const rafRef = useRef<number | null>(null);
  const pendingOriginRef = useRef<SyncOrigin>(null);
  const previewTimerRef = useRef<number | null>(null);

  const [content, setContent] = useState("");
  const [previewSource, setPreviewSource] = useState("");
  const [status, setStatus] = useState<SaveStatus>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasFile, setHasFile] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const supported = supportsDirectoryPicker();

  const anchorMap = useMemo(() => buildAnchorMap(previewSource), [previewSource]);
  blocksRef.current = anchorMap.blocks;

  useEffect(() => {
    const preview = previewRef.current;
    const view = editorViewRef.current;
    if (!preview || !hasFile) return;

    const prevScroll = preview.scrollTop;
    // Restore scroll after DOM replace; prefer editor logical position when available.
    requestAnimationFrame(() => {
      if (view) {
        const logical = logicalFromEditor(view, blocksRef.current);
        if (logical) {
          syncOriginRef.current = "editor";
          applyLogicalToPreview(preview, logical);
          requestAnimationFrame(() => {
            syncOriginRef.current = null;
          });
          return;
        }
      }
      preview.scrollTop = prevScroll;
    });
  }, [anchorMap.html, hasFile]);

  const runSync = useCallback((origin: Exclude<SyncOrigin, null>) => {
    const view = editorViewRef.current;
    const preview = previewRef.current;
    const blocks = blocksRef.current;
    if (!view || !preview || blocks.length === 0) return;

    syncOriginRef.current = origin;
    if (origin === "editor") {
      const logical = logicalFromEditor(view, blocks);
      if (logical) applyLogicalToPreview(preview, logical);
    } else {
      const logical = logicalFromPreview(preview, blocks);
      if (logical) applyLogicalToEditor(view, blocks, logical);
    }
    requestAnimationFrame(() => {
      syncOriginRef.current = null;
    });
  }, []);

  const scheduleSync = useCallback(
    (origin: Exclude<SyncOrigin, null>) => {
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
    };
  }, []);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !hasFile) return;

    const onScroll = () => {
      if (syncOriginRef.current === "preview") return;
      scheduleSync("editor");
    };

    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    return () => view.scrollDOM.removeEventListener("scroll", onScroll);
  }, [hasFile, scheduleSync, editorEpoch]);

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
      const result = await openMainMarkdown();
      if (!result.ok) {
        if (result.reason !== "cancelled") setError(result.message);
        return;
      }
      fileHandleRef.current = result.fileHandle;
      setContent(result.content);
      setPreviewSource(result.content);
      setHasFile(true);
      setStatus("saved");
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

  return (
    <div className="page">
      <header className="toolbar">
        <p className="brand">Vellum</p>
        <div className="toolbar-end">
          <span className="status" data-state={status ?? "idle"} aria-live="polite">
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
                onReady={(view) => {
                  editorViewRef.current = view;
                  setEditorEpoch((n) => n + 1);
                }}
              />
            </section>
            <section className="pane pane-preview" aria-label="HTML preview">
              <MarkdownPreview
                ref={previewRef}
                html={anchorMap.html}
                onScroll={handlePreviewScroll}
              />
            </section>
          </div>
        ) : (
          <div className="empty">
            <h1>Open a local folder to begin.</h1>
            <p className="lede">
              Choose a project folder that contains <code>main.md</code>. Edit on
              the left, preview on the right, then save back to the same file.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
