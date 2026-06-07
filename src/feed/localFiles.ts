import type { Feed, MediaItem } from "./types";

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;
const VIDEO_RE = /\.(mp4|webm|ogv|mov|m4v)$/i;

const isImage = (name: string) => IMAGE_RE.test(name);
const isVideo = (name: string) => VIDEO_RE.test(name);
const isMedia = (name: string) => isImage(name) || isVideo(name);

let localId = 0;

/** Object URLs created from local files; revoked when no longer referenced. */
const liveUrls = new Set<string>();

function track(url: string): string {
  liveUrls.add(url);
  return url;
}

/** Snapshot the currently-tracked URLs (call before loading a new feed). */
export function currentLocalUrls(): string[] {
  return Array.from(liveUrls);
}

/** Revoke a specific set of object URLs (the previous feed's). */
export function revokeUrls(urls: string[]): void {
  for (const url of urls) {
    URL.revokeObjectURL(url);
    liveUrls.delete(url);
  }
}

/** Revoke everything (used on teardown). */
export function revokeLocalUrls(): void {
  for (const url of liveUrls) URL.revokeObjectURL(url);
  liveUrls.clear();
}

/** Run async work with bounded concurrency so big folders don't stampede. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Capture the first frame of a video File as a poster thumbnail (object URL). */
async function makeVideoThumb(fullUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    video.src = fullUrl;
    const done = (result: string | null) => {
      video.removeAttribute("src");
      video.load();
      resolve(result);
    };
    video.addEventListener(
      "loadeddata",
      () => {
        try {
          const maxEdge = 512;
          const scale = Math.min(
            1,
            maxEdge / Math.max(video.videoWidth, video.videoHeight)
          );
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) return done(null);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => done(blob ? track(URL.createObjectURL(blob)) : null),
            "image/jpeg",
            0.82
          );
        } catch {
          done(null);
        }
      },
      { once: true }
    );
    video.addEventListener("error", () => done(null));
    video.currentTime = 0.1;
  });
}

/**
 * Build a MediaItem from a File. Images are *instant* (just an object URL —
 * the wall decodes/loads them lazily). Videos get a poster frame.
 */
async function fileToItem(file: File, pathHint?: string): Promise<MediaItem> {
  const fullUrl = track(URL.createObjectURL(file));
  const path = pathHint ?? file.name; // relative path within the opened folder
  const title = file.name.replace(/\.[^.]+$/, ""); // bare filename (no folders)
  if (isVideo(file.name)) {
    const poster = await makeVideoThumb(fullUrl);
    return {
      id: `local-${localId++}`,
      type: "video",
      thumb: poster ?? "",
      full: fullUrl,
      title,
      path,
    };
  }
  return {
    id: `local-${localId++}`,
    type: "image",
    thumb: fullUrl,
    full: fullUrl,
    title,
    path,
  };
}

/** Build a Feed from a flat list of File objects (input[multiple] / drag-drop). */
export async function feedFromFiles(files: File[]): Promise<Feed> {
  const media = files.filter((f) => isMedia(f.name));
  // Stable, human-friendly order.
  media.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const items = await mapPool(media, 6, (f) => {
    const rel = (f as unknown as { _path?: string; webkitRelativePath?: string });
    return fileToItem(f, rel._path || rel.webkitRelativePath || f.name);
  });
  return { title: `${items.length} local file(s)`, items };
}

/* ----------------------- File System Access API ----------------------- */

interface FSDirHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterableIterator<FSDirHandle | FSFileHandle>;
}
interface FSFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}

declare global {
  interface Window {
    showOpenFilePicker?: (opts?: unknown) => Promise<FSFileHandle[]>;
    showDirectoryPicker?: (opts?: unknown) => Promise<FSDirHandle>;
  }
}

export const supportsFsAccess = () =>
  typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

async function collectDir(
  dir: FSDirHandle,
  prefix: string,
  out: { file: File; path: string }[]
): Promise<void> {
  for await (const entry of dir.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "file") {
      if (isMedia(entry.name)) out.push({ file: await entry.getFile(), path });
    } else {
      await collectDir(entry, path, out);
    }
  }
}

/** Open a folder via the File System Access API and recurse into subfolders. */
export async function feedFromDirectoryPicker(): Promise<Feed> {
  if (!window.showDirectoryPicker) throw new Error("Directory picker unsupported.");
  const dir = await window.showDirectoryPicker();
  const collected: { file: File; path: string }[] = [];
  await collectDir(dir, "", collected);
  collected.sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true })
  );
  const items = await mapPool(collected, 6, ({ file, path }) =>
    fileToItem(file, path)
  );
  return { title: `${dir.name} — ${items.length} item(s)`, items };
}

/** Open one or more files via the File System Access API. */
export async function feedFromFilePicker(): Promise<Feed> {
  if (!window.showOpenFilePicker) throw new Error("File picker unsupported.");
  const handles = await window.showOpenFilePicker({
    multiple: true,
    types: [
      {
        description: "Media",
        accept: {
          "image/*": [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp", ".svg"],
          "video/*": [".mp4", ".webm", ".ogv", ".mov", ".m4v"],
        },
      },
    ],
  });
  const files = await Promise.all(handles.map((h) => h.getFile()));
  return feedFromFiles(files);
}

/** Extract Files from a drag-and-drop DataTransfer, recursing into folders. */
export async function feedFromDataTransfer(dt: DataTransfer): Promise<Feed> {
  const files: File[] = [];

  const readEntry = async (entry: any, prefix = ""): Promise<void> => {
    if (!entry) return;
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej));
      if (isMedia(file.name)) {
        Object.defineProperty(file, "_path", { value: `${prefix}${file.name}` });
        files.push(file);
      }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries returns in batches; loop until empty.
      for (;;) {
        const batch: any[] = await new Promise((res) =>
          reader.readEntries((e: any[]) => res(e))
        );
        if (!batch.length) break;
        for (const child of batch) await readEntry(child, `${prefix}${entry.name}/`);
      }
    }
  };

  const items = Array.from(dt.items).filter((i) => i.kind === "file");
  const canRecurse = items.some(
    (i) => typeof (i as any).webkitGetAsEntry === "function"
  );

  if (canRecurse) {
    const entries = items.map((i) => (i as any).webkitGetAsEntry());
    for (const entry of entries) await readEntry(entry);
    return feedFromFiles(files);
  }
  return feedFromFiles(Array.from(dt.files));
}
