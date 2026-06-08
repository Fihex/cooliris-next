import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promises as fs } from "node:fs";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist-electron/main.js  →  project root is one level up.
process.env.APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

let win: BrowserWindow | null = null;

/* --------------------------- local-media protocol --------------------------- */
// A privileged scheme so the renderer (http:// in dev, file:// in prod) can load
// files from anywhere on disk *by streaming* — we never read whole files into JS.
// URL shape: coolmedia://f/<encodeURIComponent(absolutePath)>
protocol.registerSchemesAsPrivileged([
  {
    scheme: "coolmedia",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
  // Serve the bundled renderer from a real origin (app://bundle/) so the SPA
  // router and absolute fetches like /sample-feed.json work — file:// gives the
  // document a disk path as its pathname, which matches no route (blank screen).
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

/* ------------------------------- folder scan -------------------------------- */
const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;
const VIDEO_RE = /\.(mp4|webm|ogv|mov|m4v|mkv|avi)$/i;
const AUDIO_RE = /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|weba)$/i;
const SUB_RE = /\.(srt|vtt)$/i;
const isMedia = (n: string) => IMAGE_RE.test(n) || VIDEO_RE.test(n) || AUDIO_RE.test(n);

interface SubFile {
  abs: string;
  label: string;
  ext: string; // "srt" | "vtt"
}

interface ScanFile {
  abs: string;
  rel: string;
  name: string;
  mtime: number;
  subs?: SubFile[];
}

/** Find sidecar subtitle files (same stem) for a video, given its dir's entries. */
function siblingSubs(videoName: string, dir: string, names: string[]): SubFile[] {
  const stem = videoName.replace(/\.[^.]+$/, "");
  const subs: SubFile[] = [];
  for (const n of names) {
    const m = n.match(SUB_RE);
    if (!m || !n.startsWith(stem) || n === videoName) continue;
    // The bit between the video stem and the extension becomes the label ("en", …).
    const label = n.slice(stem.length).replace(SUB_RE, "").replace(/^[.\-_\s]+/, "");
    subs.push({ abs: path.join(dir, n), label: label || "Subtitles", ext: m[1].toLowerCase() });
  }
  return subs;
}

async function statMtime(abs: string): Promise<number> {
  try {
    return (await fs.stat(abs)).mtimeMs;
  } catch {
    return 0;
  }
}

/** Recursively collect media files under a root directory (Node fs — fast, no upload). */
async function scanDir(root: string): Promise<ScanFile[]> {
  const out: ScanFile[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = entries.map((e) => e.name);
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(abs, rel);
      } else if (e.isFile() && isMedia(e.name)) {
        const subs = VIDEO_RE.test(e.name) ? siblingSubs(e.name, dir, names) : [];
        out.push({
          abs,
          rel,
          name: e.name,
          mtime: await statMtime(abs),
          subs: subs.length ? subs : undefined,
        });
      }
    }
  }
  await walk(root, "");
  return out;
}

/* ----------------------------------- IPC ------------------------------------ */
ipcMain.handle("pick-folder", async () => {
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  const root = r.filePaths[0];
  return { rootName: path.basename(root), files: await scanDir(root) };
});

ipcMain.handle("pick-files", async () => {
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Media",
        extensions: [
          "jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg",
          "mp4", "webm", "ogv", "mov", "m4v", "mkv", "avi",
          "mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "opus", "weba",
        ],
      },
    ],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const files: ScanFile[] = await Promise.all(
    r.filePaths.map(async (abs) => {
      const name = path.basename(abs);
      let subs: SubFile[] | undefined;
      if (VIDEO_RE.test(name)) {
        try {
          const dir = path.dirname(abs);
          const found = siblingSubs(name, dir, await fs.readdir(dir));
          subs = found.length ? found : undefined;
        } catch {
          /* ignore */
        }
      }
      return { abs, rel: name, name, mtime: await statMtime(abs), subs };
    })
  );
  return { rootName: `${files.length} file(s)`, files };
});

// Fetch a remote URL from the main process — no browser CORS, so the desktop app
// loads remote JSON feeds directly (no third-party proxy).
ipcMain.handle("fetch-text", async (_e, url: string) => {
  const res = await net.fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Failed to load feed (${res.status} ${res.statusText})`);
  return res.text();
});

/* --------------------------------- window ----------------------------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Keep WebGL hardware-accelerated; let pages persist GPU resources.
      backgroundThrottling: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadURL("app://bundle/");
    // No menu in production → removes the default Reload/DevTools accelerators.
    Menu.setApplicationMenu(null);
    // Belt-and-suspenders: also swallow Chromium's built-in reload keys. A reload
    // tears down the WebGL wall and the in-memory feed → black screen, so block it.
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const key = input.key.toLowerCase();
      const reload = (input.control || input.meta) && key === "r";
      if (reload || key === "f5") {
        event.preventDefault();
        return;
      }
      // F12 still toggles DevTools (the default menu accelerator is gone).
      if (key === "f12") {
        event.preventDefault();
        win?.webContents.toggleDevTools();
      }
    });
  }

  win.on("closed", () => {
    win = null;
  });
}

app.whenReady().then(() => {
  protocol.handle("coolmedia", async (request) => {
    const url = new URL(request.url);
    const abs = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const res = await net.fetch(pathToFileURL(abs).toString());
    // The renderer lives on a different origin (app://bundle), and it consumes
    // these files as WebGL textures (THREE.TextureLoader uses crossOrigin="anonymous")
    // and draws videos to a <canvas> for posters. Without CORS the image loads are
    // rejected and the canvas is tainted → no previews. Allow it explicitly.
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  });

  // Serve the renderer bundle from dist/, with SPA fallback to index.html.
  protocol.handle("app", async (request) => {
    const { pathname } = new URL(request.url);
    const rel = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
    const filePath = path.join(RENDERER_DIST, rel);
    const indexFile = path.join(RENDERER_DIST, "index.html");
    // Stay inside dist/; anything else (or a missing deep route) falls back to index.html.
    const target = filePath.startsWith(RENDERER_DIST) ? filePath : indexFile;
    try {
      return await net.fetch(pathToFileURL(target).toString());
    } catch {
      return net.fetch(pathToFileURL(indexFile).toString());
    }
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
