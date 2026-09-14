const MAIN_MD = "main.md";

export type OpenResult =
  | { ok: true; fileHandle: FileSystemFileHandle; content: string }
  | { ok: false; reason: "unsupported" | "cancelled" | "missing" | "error"; message: string };

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "error"; message: string };

export function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function openMainMarkdown(): Promise<OpenResult> {
  if (!supportsDirectoryPicker()) {
    return {
      ok: false,
      reason: "unsupported",
      message: "This browser does not support the File System Access API. Use Chrome or Edge.",
    };
  }

  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    let fileHandle: FileSystemFileHandle;
    try {
      fileHandle = await dirHandle.getFileHandle(MAIN_MD);
    } catch {
      return {
        ok: false,
        reason: "missing",
        message: `${MAIN_MD} was not found in the selected folder.`,
      };
    }

    const file = await fileHandle.getFile();
    const content = await file.text();
    return { ok: true, fileHandle, content };
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, reason: "cancelled", message: "Folder selection was cancelled." };
    }
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Failed to open folder.",
    };
  }
}

export async function saveMainMarkdown(
  fileHandle: FileSystemFileHandle,
  content: string,
): Promise<SaveResult> {
  try {
    if (
      (await fileHandle.queryPermission({ mode: "readwrite" })) !== "granted" &&
      (await fileHandle.requestPermission({ mode: "readwrite" })) !== "granted"
    ) {
      return {
        ok: false,
        reason: "error",
        message: "Write permission was denied.",
      };
    }

    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return { ok: true };
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, reason: "cancelled", message: "Save was cancelled." };
    }
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Failed to save file.",
    };
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
