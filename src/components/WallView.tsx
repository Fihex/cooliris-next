import { useCallback, useEffect, useRef, useState } from "react";
import { WallScene } from "@/wall/WallScene";
import type { Feed, MediaItem } from "@/feed/types";
import { loadJsonFeedFromUrl } from "@/feed/jsonFeed";
import {
  currentLocalUrls,
  feedFromDirectoryPicker,
  feedFromFilePicker,
  feedFromFiles,
  revokeLocalUrls,
  revokeUrls,
  supportsFsAccess,
} from "@/feed/localFiles";
import { embed, type WallController } from "@/embed/cooliris-embed";
import { Toolbar, type LoadProgress } from "./Toolbar";
import { Scrubber, type ScrubberHandle } from "./Scrubber";
import { Toasts, type ToastMessage } from "./Toast";

export function WallView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<WallScene | null>(null);
  const scrubberRef = useRef<ScrubberHandle>(null);
  const hoverLabelRef = useRef<HTMLDivElement>(null);
  const masterRef = useRef<MediaItem[]>([]); // full feed, pre-search
  const itemsRef = useRef<MediaItem[]>([]); // displayed (post-search)
  const searchRef = useRef("");

  const [items, setItems] = useState<MediaItem[]>([]);
  const [feedTitle, setFeedTitle] = useState<string>();
  const [selected, setSelected] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const [showTitles, setShowTitles] = useState(false);
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState<LoadProgress>({ loaded: 0, total: 0, pending: 0 });
  const [hover, setHover] = useState<MediaItem | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);

  const toast = useCallback((text: string, kind: ToastMessage["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const applySearch = useCallback((q: string) => {
    searchRef.current = q;
    const query = q.trim().toLowerCase();
    const filtered = query
      ? masterRef.current.filter((it) => (it.title ?? "").toLowerCase().includes(query))
      : masterRef.current;
    itemsRef.current = filtered;
    setItems(filtered);
    setSelected(-1);
    sceneRef.current?.setItems(filtered);
  }, []);

  const applyFeed = useCallback(
    (feed: Feed) => {
      masterRef.current = feed.items;
      setFeedTitle(feed.title);
      setSearch("");
      applySearch("");
      embed.callbacks.feedload?.(feed.items.length);
    },
    [applySearch]
  );

  const runFeedTask = useCallback(
    async (task: () => Promise<Feed>) => {
      setBusy(true);
      // Snapshot the previous feed's object URLs; revoke them only AFTER the new
      // feed (with its own freshly-created URLs) has loaded successfully.
      const oldUrls = currentLocalUrls();
      try {
        const feed = await task();
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
          fsAccess={supportsFsAccess()}
          onOpenFiles={(files) => runFeedTask(() => feedFromFiles(files))}
          onOpenFilePicker={() => runFeedTask(() => feedFromFilePicker())}
          onOpenFolderPicker={() => runFeedTask(() => feedFromDirectoryPicker())}
          onLoadUrl={(url) => runFeedTask(() => loadJsonFeedFromUrl(url))}
          onSearch={(q) => {
            setSearch(q);
            applySearch(q);
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
            <p className="text-lg">{search ? "No matches" : "Open files or a folder to begin"}</p>
            {!search && (
              <p className="text-sm">Use Open files / Open folder / Load JSON URL above</p>
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

      {/* Focused (zoomed) view: in-scene zoom + caption under the image */}
      {selectedItem && (
        <>
          <button
            onClick={() => sceneRef.current?.deselect()}
            className="absolute left-4 top-4 z-30 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white backdrop-blur hover:bg-white/20"
          >
            ← Back
          </button>

          {/* Videos play large on a dark backdrop (covers the wall behind);
              click the backdrop to exit, click the video does nothing. */}
          {selectedItem.type === "video" && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/85 p-10"
              onClick={() => sceneRef.current?.deselect()}
            >
              <video
                key={selectedItem.id}
                src={selectedItem.full}
                controls
                autoPlay
                onClick={(e) => e.stopPropagation()}
                className="h-[78vh] w-auto max-w-[90vw] rounded-lg object-contain shadow-2xl"
              />
            </div>
          )}

          {/* Caption bar (title + path at the bottom of the image) + prev/next */}
          <div className="absolute bottom-12 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3">
            <NavButton dir="prev" onClick={() => sceneRef.current?.prev()} />
            <div className="min-w-[8rem] max-w-[70vw] rounded-2xl bg-black/70 px-5 py-2 text-center backdrop-blur ring-1 ring-white/10">
              <div className="truncate text-sm font-medium text-white">
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
                  className="block max-w-full truncate text-xs text-white/55 hover:text-white/80"
                  dir="rtl"
                >
                  {selectedItem.path}
                </button>
              )}
              <div className="text-xs text-white/40">
                {selected + 1} / {items.length}
              </div>
            </div>
            <NavButton dir="next" onClick={() => sceneRef.current?.next()} />
          </div>
        </>
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

/** Round nav button used in the focused caption bar. */
function NavButton({ dir, onClick }: { dir: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={dir === "prev" ? "Previous" : "Next"}
      className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-2xl text-white backdrop-blur hover:bg-white/20"
    >
      {dir === "prev" ? "‹" : "›"}
    </button>
  );
}
