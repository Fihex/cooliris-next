import type { Feed, MediaItem, ProgressFn } from "@/feed/types";
import {
  currentLocalUrls,
  feedFromDataTransfer,
  feedFromFiles,
  isAudio,
  isVideo,
  makeAudioThumb,
  makeVideoThumb,
  mapPool,
  revokeLocalUrls,
  revokeUrls,
} from "@/feed/localFiles";
import type { Platform } from "./Platform";

/* ----- bridge contract (must match electron/preload.ts + main.ts) ----- */
interface SubFile {
  abs: string;
  label: string;
  ext: string;
}
interface ScanFile {
  abs: string;
  rel: string;
  name: string;
  mtime: number;
  subs?: SubFile[];
}
interface ScanResult {
  rootName: string;
  files: ScanFile[];
}
interface ElectronBridge {
  pickFolder(): Promise<ScanResult | null>;
  pickFiles(): Promise<ScanResult | null>;
  fetchText(url: string): Promise<string>;
}

declare global {
  interface Window {
    electron?: ElectronBridge;
  }
}

let eid = 0;

/** Stream a local file to the renderer via the privileged custom protocol. */
function mediaUrl(abs: string): string {
  return `coolmedia://f/${encodeURIComponent(abs)}`;
}

/** Match the web picker's cancel semantics so WallView ignores it. */
function aborted(): never {
  throw new DOMException("Picker cancelled", "AbortError");
}

async function feedFromScan(res: ScanResult, onProgress?: ProgressFn): Promise<Feed> {
  const files = [...res.files].sort((a, b) =>
    a.rel.localeCompare(b.rel, undefined, { numeric: true })
  );
  const items = await mapPool(
    files,
    6,
    async (f): Promise<MediaItem> => {
      const url = mediaUrl(f.abs);
      const title = f.name.replace(/\.[^.]+$/, "");
      const date = f.mtime || undefined;
      if (isVideo(f.name)) {
        const poster = await makeVideoThumb(url);
        return {
          id: `el-${eid++}`,
          type: "video",
          thumb: poster ?? "",
          full: url,
          title,
          path: f.rel,
          date,
          subs: f.subs?.map((s) => ({
            url: mediaUrl(s.abs),
            label: s.label,
            srt: s.ext === "srt",
          })),
        };
      }
      if (isAudio(f.name)) {
        const art = await makeAudioThumb(title);
        return {
          id: `el-${eid++}`,
          type: "audio",
          thumb: art ?? "",
          full: url,
          title,
          path: f.rel,
          date,
          aspect: 512 / 384,
        };
      }
      return {
        id: `el-${eid++}`,
        type: "image",
        animated: /\.gif$/i.test(f.name) || undefined,
        thumb: url,
        full: url,
        title,
        path: f.rel,
        date,
      };
    },
    onProgress
  );
  return { title: `${res.rootName} — ${items.length} item(s)`, items };
}

/** Electron implementation: native dialogs + Node fs scan, streamed via coolmedia://. */
export const electronPlatform: Platform = {
  name: "electron",
  supportsFolderPicker: true,

  // Fetch remote feeds via the main process — no CORS, no third-party proxy.
  fetchRemoteText: (url: string): Promise<string> => window.electron!.fetchText(url),

  pickFiles: async (onProgress?: ProgressFn): Promise<Feed> => {
    const r = await window.electron!.pickFiles();
    if (!r) aborted();
    return feedFromScan(r, onProgress);
  },
  pickFolder: async (onProgress?: ProgressFn): Promise<Feed> => {
    const r = await window.electron!.pickFolder();
    if (!r) aborted();
    return feedFromScan(r, onProgress);
  },

  // Drag-and-drop / <input> reuse the web path (object URLs) — works in Electron too.
  fromDataTransfer: (dt: DataTransfer, onProgress?: ProgressFn): Promise<Feed> =>
    feedFromDataTransfer(dt, onProgress),
  fromFileList: (files: File[], onProgress?: ProgressFn): Promise<Feed> =>
    feedFromFiles(files, onProgress),

  // Only the DnD/input fallbacks create object URLs; coolmedia:// needs no revoke.
  snapshotResources: () => currentLocalUrls(),
  releaseResources: (snapshot: unknown) => revokeUrls((snapshot as string[]) ?? []),
  releaseAll: () => revokeLocalUrls(),
};
