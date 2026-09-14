import { useRef, useState } from "react";
import { openMainMarkdown, saveMainMarkdown, supportsDirectoryPicker } from "./fs";
import "./App.css";

type SaveStatus = "saved" | "unsaved" | null;

export default function App() {
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<SaveStatus>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasFile, setHasFile] = useState(false);
  const supported = supportsDirectoryPicker();

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
  }

  return (
    <div className="page">
      <div className="sheet">
        <div className="grain" aria-hidden />

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

        <div className="editor-wrap">
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
            <textarea
              className="editor"
              value={content}
              onChange={(e) => handleChange(e.target.value)}
              spellCheck={false}
              aria-label="Markdown editor"
            />
          ) : (
            <div className="empty">
              <h1>Open a local folder to begin.</h1>
              <p className="lede">
                Choose a project folder that contains <code>main.md</code>. Edit
                Markdown in the browser, then save it back to the same file.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
