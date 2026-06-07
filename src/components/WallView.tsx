import { useCallback, useEffect, useRef, useState } from "react";
import { WallScene } from "@/wall/WallScene";
import type { Feed, MediaItem } from "@/feed/types";
import {
  loadJsonFeedFromUrl,
  loadJsonFeedFromFile,
  loadJsonFeedFromText,
} from "@/feed/jsonFeed";
import {
  currentLocalUrls,
  feedFromDataTransfer,
  feedFromDirectoryPicker,
  feedFromFilePicker,
  feedFromFiles,
  revokeLocalUrls,
  revokeUrls,
  supportsFsAccess,
} from "@/feed/localFiles";
import { embed, type WallController } from "@/embed/cooliris-embed";
import { Toolbar, type LoadProgress } from "./Toolbar";
import { OpenDialog } from "./OpenDialog";
import { JsonDialog } from "./JsonDialog";
import { Scrubber, type ScrubberHandle } from "./Scrubber";
import { Toasts, type ToastMessage } from "./Toast";

export function WallView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<WallScene | null>(null);
  const scrubberRef = useRef<ScrubberHandle>(null);
  const hoverLabelRef = useRef<HTMLDivElement>(null);
  const masterRef = useRef<MediaItem[]>([]); // full feed, pre-filter
  const itemsRef = useRef<MediaItem[]>([]); // displayed (post-filter)
  const searchRef = useRef("");
  const fromRef = useRef(""); // yyyy-mm-dd
  const toRef = useRef("");

  const [items, setItems] = useState<MediaItem[]>([]);
  const [feedTitle, setFeedTitle] = useState<string>();
  const [selected, setSelected] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const [showTitles, setShowTitles] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [openOpen, setOpenOpen] = useState(false);
  const [loadStage, setLoadStage] = useState<{ done: number; total: number } | null>(null);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [progress, setProgress] = useState<LoadProgress>({ loaded: 0, total: 0, pending: 0 });
  const [hover, setHover] = useState<MediaItem | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);

  const toast = useCallback((text: string, kind: ToastMessage["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  // Combined filter: search text + last-modified date range.
  const applyFilters = useCallback(() => {
    const query = searchRef.current.trim().toLowerCase();
    const fromMs = fromRef.current ? new Date(fromRef.current + "T00:00:00").getTime() : null;
    const toMs = toRef.current ? new Date(toRef.current + "T23:59:59.999").getTime() : null;
    const hasDate = fromMs !== null || toMs !== null;
    const filtered = masterRef.current.filter((it) => {
      if (query && !(it.title ?? "").toLowerCase().includes(query)) return false;
      if (hasDate) {
        if (it.date == null) return false;
        if (fromMs !== null && it.date < fromMs) return false;
        if (toMs !== null && it.date > toMs) return false;
      }
      return true;
    });
    itemsRef.current = filtered;
    setItems(filtered);
    setSelected(-1);
    sceneRef.current?.setItems(filtered);
  }, []);

  const applyFeed = useCallback(
    (feed: Feed) => {
      masterRef.current = feed.items;
      setFeedTitle(feed.title);
      // Reset filters for the new feed.
      searchRef.current = "";
      fromRef.current = "";
      toRef.current = "";
      setSearch("");
      setFromDate("");
      setToDate("");
      applyFilters();
      embed.callbacks.feedload?.(feed.items.length);
    },
    [applyFilters]
  );

  const runFeedTask = useCallback(
    async (task: (onProgress: (done: number, total: number) => void) => Promise<Feed>) => {
      setBusy(true);
      setLoadStage(null);
      // Snapshot the previous feed's object URLs; revoke them only AFTER the new
      // feed (with its own freshly-created URLs) has loaded successfully.
      const oldUrls = currentLocalUrls();
      const onProgress = (done: number, total: number) => setLoadStage({ done, total });
      try {
        const feed = await task(onProgress);
        applyFeed(feed);
        revokeUrls(oldUrls);
        toast(`Loaded ${feed.items.length} item(s)`);
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return; // picker cancelled
        const msg = err instanceof Error ? err.message : String(err);
        toast(msg, "error");
        embed.callbacks.feederror?.(msg);
      } finally {
        setBusy(false);
        setLoadStage(null);
      }
    },
    [applyFeed, toast]
  );

  /* ---------------------------- create the scene ---------------------------- */
  useEffect(() => {
    if (!containerRef.current) return;
    let scene: WallScene;
    try {
      scene = new WallScene(containerRef.current);
    } catch (err) {
      setFatal(
        "Could not start WebGL. Your browser or GPU may have it disabled. " +
          (err instanceof Error ? err.message : "")
      );
      return;
    }
    sceneRef.current = scene;

    scene.on("select", (index: number, item: MediaItem | null) => {
      setSelected(index);
      embed.callbacks.select?.(index, item);
    });
    scene.on("deselect", () => {
      setSelected(-1);
      setSlideshow(false);
      scene.setSlideshow(false);
      embed.callbacks.deselect?.(-1);
    });
    scene.on("hover", (_index: number, item: MediaItem | null) => setHover(item));
    scene.on("progress", (loaded: number, total: number, pending: number) =>
      setProgress({ loaded, total, pending })
    );
    scene.on("scroll", (info) => scrubberRef.current?.update(info));

    const controller: WallController = {
      setFeedURL: (url) => runFeedTask(() => loadJsonFeedFromUrl(url)).then(() => undefined),
      getItems: () => itemsRef.current,
      selectItemByIndex: (i) => scene.selectIndex(i),
      selectItemByGUID: (guid) => {
        const i = itemsRef.current.findIndex((it) => it.id === guid);
        if (i >= 0) scene.selectIndex(i);
      },
      getSelectedItem: () =>
        scene.selected >= 0 ? itemsRef.current[scene.selected] ?? null : null,
      deselect: () => scene.deselect(),
    };
    embed._attach(controller);

    return () => {
      embed._detach();
      scene.dispose();
      sceneRef.current = null;
      revokeLocalUrls();
    };
  }, [runFeedTask]);

  /* ----------------------------- initial feed ------------------------------ */
  useEffect(() => {
    runFeedTask(() => loadJsonFeedFromUrl("/sample-feed.json")).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------- sync scrubber thumb after a feed loads ------------------- */
  useEffect(() => {
    if (!items.length) return;
    const id = requestAnimationFrame(() => {
      const s = sceneRef.current;
      if (s) scrubberRef.current?.update(s.getScrollInfo());
    });
    return () => cancelAnimationFrame(id);
  }, [items.length]);

  /* ------------------------------- keyboard -------------------------------- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const scene = sceneRef.current;
      if (!scene) return;
      if (e.key === "Escape") {
        scene.deselect();
      } else if (e.key === "ArrowRight") {
        if (selected >= 0) {
          if (!e.repeat) scene.next();
        } else scene.startScroll(1); // hold = smooth accelerate
      } else if (e.key === "ArrowLeft") {
        if (selected >= 0) {
          if (!e.repeat) scene.prev();
        } else scene.startScroll(-1);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && selected < 0) {
        sceneRef.current?.stopScroll(); // release = smooth momentum stop
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [selected]);

  /* ------------------------------ handlers --------------------------------- */
  const toggleSlideshow = () => {
    const next = !slideshow;
    setSlideshow(next);
    sceneRef.current?.setSlideshow(next);
  };

  const fullscreen = () => {
    const el = containerRef.current?.parentElement ?? document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  const toggleTitles = () => {
    const next = !showTitles;
    setShowTitles(next);
    sceneRef.current?.setShowTitles(next);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const label = hoverLabelRef.current;
    if (label) {
      label.style.left = `${e.clientX}px`;
      label.style.top = `${e.clientY - 18}px`;
    }
  };

  const selectedItem = selected >= 0 ? items[selected] : null;
  // Hover tooltip is suppressed while the Titles toggle shows every label.
  const showHover = hover && selected < 0 && !showTitles;
  const loadPct = loadStage && loadStage.total > 0
    ? Math.round((loadStage.done / loadStage.total) * 100)
    : null;

  return (
    <div className="relative h-full w-full overflow-hidden" onPointerMove={onPointerMove}>
      <div ref={containerRef} className="absolute inset-0" />

      {fatal && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-6">
          <div className="max-w-md rounded-xl bg-red-500/15 p-5 text-center text-sm text-red-100 ring-1 ring-red-400/30">
            {fatal}
          </div>
        </div>
      )}

      {/* Toolbar hides while a photo is focused (clean view; Back replaces it) */}
      {selected < 0 && (
        <Toolbar
          title={feedTitle}
          count={items.length}
          busy={busy}
          progress={progress}
          slideshow={slideshow}
          titles={showTitles}
          search={search}
          fromDate={fromDate}
          toDate={toDate}
          onOpen={() => setOpenOpen(true)}
          onSearch={(q) => {
            setSearch(q);
            searchRef.current = q;
            applyFilters();
          }}
          onFromDate={(d) => {
            setFromDate(d);
            fromRef.current = d;
            applyFilters();
          }}
          onToDate={(d) => {
            setToDate(d);
            toRef.current = d;
            applyFilters();
          }}
          onToggleSlideshow={toggleSlideshow}
          onToggleTitles={toggleTitles}
          onFullscreen={fullscreen}
        />
      )}

      {/* Edge arrows — hold to smoothly accelerate, release to glide to a stop */}
      {selected < 0 && items.length > 0 && (
        <>
          <EdgeArrow
            side="left"
            onStart={() => sceneRef.current?.startScroll(-1)}
            onStop={() => sceneRef.current?.stopScroll()}
          />
          <EdgeArrow
            side="right"
            onStart={() => sceneRef.current?.startScroll(1)}
            onStop={() => sceneRef.current?.stopScroll()}
          />
        </>
      )}

      {/* Empty state */}
      {items.length === 0 && !busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="px-6 text-center text-white/50">
            <p className="text-lg">{search ? "No matches" : "Open media to begin"}</p>
            {!search && <p className="text-sm">Press Open to choose files, a folder, or JSON</p>}
          </div>
        </div>
      )}

      {/* Loading progress (with percent) while a folder/file set is processed */}
      {busy && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div className="w-72 max-w-[80vw] rounded-2xl bg-black/75 p-5 text-center text-white shadow-2xl ring-1 ring-white/10">
            <div className="mb-2 text-sm font-medium">
              {loadPct !== null
                ? `Loading ${loadPct}%`
                : loadStage
                  ? `Scanning… ${loadStage.done.toLocaleString()} files`
                  : "Loading…"}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/15">
              <div
                className={`h-full rounded-full bg-white ${
                  loadPct !== null ? "transition-[width] duration-150" : "animate-pulse"
                }`}
                style={{ width: loadPct !== null ? `${loadPct}%` : "100%" }}
              />
            </div>
            {loadPct !== null && loadStage && (
              <div className="mt-2 text-xs text-white/50">
                {loadStage.done.toLocaleString()} / {loadStage.total.toLocaleString()} files
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hover title tooltip (follows the cursor; hidden when Titles toggle is on) */}
      <div
        ref={hoverLabelRef}
        className={`pointer-events-none fixed z-30 max-w-xs -translate-x-1/2 -translate-y-full truncate rounded-md bg-black/80 px-2 py-1 text-xs text-white shadow ring-1 ring-white/10 transition-opacity ${
          showHover ? "opacity-100" : "opacity-0"
        }`}
      >
        {hover?.title || "Untitled"}
      </div>

      {/* Bottom scrubber (visual only — input handled by the wall's scrub zone) */}
      {selected < 0 && items.length > 0 && <Scrubber ref={scrubberRef} />}

      {/* Focused (zoomed) view */}
      {selectedItem && (
        <>
          <button
            onClick={() => sceneRef.current?.deselect()}
            className="absolute left-4 top-4 z-40 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white backdrop-blur hover:bg-white/20"
          >
            ← Back
          </button>

          {/* Videos play large on a dark backdrop; click the backdrop to exit. */}
          {selectedItem.type === "video" && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/85 px-20 pb-24 pt-16"
              onClick={() => sceneRef.current?.deselect()}
            >
              <video
                key={selectedItem.id}
                src={selectedItem.full}
                controls
                autoPlay
                onClick={(e) => e.stopPropagation()}
                className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              />
            </div>
          )}

          {/* Permanent prev/next at the edges (fixed position; photos AND videos) */}
          <FocusArrow side="left" onClick={() => sceneRef.current?.prev()} />
          <FocusArrow side="right" onClick={() => sceneRef.current?.next()} />

          {/* Caption pinned to the very bottom — info only, wraps if long */}
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-20">
            <div className="pointer-events-auto max-h-36 max-w-[60vw] overflow-y-auto rounded-2xl bg-black/70 px-5 py-2 text-center backdrop-blur ring-1 ring-white/10">
              <div className="text-sm font-medium text-white [overflow-wrap:anywhere]">
                {selectedItem.title || "Untitled"}
                {selectedItem.link && (
                  <a
                    href={selectedItem.link}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 text-white/60 hover:text-white"
                  >
                    ↗
                  </a>
                )}
              </div>
              {selectedItem.path && (
                <button
                  type="button"
                  title="Click to copy path"
                  onClick={() => navigator.clipboard?.writeText(selectedItem.path ?? "")}
                  className="block w-full text-xs text-white/55 [overflow-wrap:anywhere] hover:text-white/80"
                >
                  {selectedItem.path}
                </button>
              )}
              <div className="text-xs text-white/40">
                {selected + 1} / {items.length}
                {selectedItem.date ? ` · ${new Date(selectedItem.date).toLocaleDateString()}` : ""}
              </div>
            </div>
          </div>
        </>
      )}

      {openOpen && (
        <OpenDialog
          fsAccess={supportsFsAccess()}
          onClose={() => setOpenOpen(false)}
          onFiles={(files) => {
            setOpenOpen(false);
            runFeedTask((p) => feedFromFiles(files, p));
          }}
          onFilePicker={() => {
            setOpenOpen(false);
            runFeedTask((p) => feedFromFilePicker(p));
          }}
          onFolderPicker={() => {
            setOpenOpen(false);
            runFeedTask((p) => feedFromDirectoryPicker(p));
          }}
          onDrop={(dt) => {
            setOpenOpen(false);
            runFeedTask((p) => feedFromDataTransfer(dt, p));
          }}
          onJson={() => {
            setOpenOpen(false);
            setJsonOpen(true);
          }}
        />
      )}

      {jsonOpen && (
        <JsonDialog
          onClose={() => setJsonOpen(false)}
          onUrl={(url) => {
            setJsonOpen(false);
            runFeedTask(() => loadJsonFeedFromUrl(url));
          }}
          onFile={(file) => {
            setJsonOpen(false);
            runFeedTask(() => loadJsonFeedFromFile(file));
          }}
          onText={(txt) => {
            setJsonOpen(false);
            runFeedTask(async () => loadJsonFeedFromText(txt));
          }}
        />
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}

/** A large edge arrow that smoothly scrolls while held. */
function EdgeArrow({
  side,
  onStart,
  onStop,
}: {
  side: "left" | "right";
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <button
      onPointerDown={onStart}
      onPointerUp={onStop}
      onPointerLeave={onStop}
      onPointerCancel={onStop}
      aria-label={side === "left" ? "Scroll left" : "Scroll right"}
      className={`absolute top-1/2 z-20 flex h-20 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/20 text-3xl text-white/60 backdrop-blur-sm transition hover:bg-black/40 hover:text-white ${
        side === "left" ? "left-3" : "right-3"
      }`}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}

/** Permanent prev/next arrow at a screen edge while a photo/video is focused. */
function FocusArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={side === "left" ? "Previous" : "Next"}
      className={`absolute top-1/2 z-40 flex h-16 w-16 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-4xl text-white/80 backdrop-blur transition hover:bg-black/60 hover:text-white ${
        side === "left" ? "left-4" : "right-4"
      }`}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
