import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaItem } from "@/feed/types";
import { VideoPlayer } from "./VideoPlayer";

interface LightboxProps {
  item: MediaItem;
  index: number;
  total: number;
  closing?: boolean; // fading out (driven by the parent)
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Full-screen media viewer (opaque, so the wall behind never shows through).
 * Wheel/pinch zoom, drag/2-finger pan. Clicking the media or controls never
 * closes — only an empty-area tap, Back, or Esc do. Media can't be selected/dragged.
 */
export function Lightbox({ item, index, total, closing, onClose, onPrev, onNext }: LightboxProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const tRef = useRef(t);
  tRef.current = t;

  const [shown, setShown] = useState(false); // for fade-in
  const [smooth, setSmooth] = useState(false); // transition on for wheel, off for drag/pinch
  const [showInfo, setShowInfo] = useState(true); // info panel (title/path/date) toggle
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef(0);
  const moved = useRef(false);
  const downOnEmpty = useRef(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Reset zoom whenever the shown item changes.
  useEffect(() => setT({ s: 1, x: 0, y: 0 }), [item.id]);

  // Keyboard: Esc closes, arrows navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onNext();
      else if (e.key === "ArrowLeft") onPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  const zoomAt = useCallback((factor: number, clientX: number, clientY: number) => {
    setT((p) => {
      const s2 = clamp(p.s * factor, MIN_SCALE, MAX_SCALE);
      if (s2 === 1) return { s: 1, x: 0, y: 0 };
      const r = stageRef.current!.getBoundingClientRect();
      const px = clientX - (r.left + r.width / 2);
      const py = clientY - (r.top + r.height / 2);
      return { s: s2, x: px - (px - p.x) * (s2 / p.s), y: py - (py - p.y) * (s2 / p.s) };
    });
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setSmooth(true); // animate between wheel steps
    zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    moved.current = false;
    const isMouse = e.pointerType === "mouse";
    // A left-click / touch on empty space can become a close-tap.
    const onEmpty = !(e.target as HTMLElement).closest("[data-media],[data-control]");
    downOnEmpty.current = onEmpty && (!isMouse || e.button === 0);

    // Pan/pinch is driven by the MIDDLE or RIGHT mouse button (left stays free for
    // taps and the native media controls), or by touch/pen.
    const canPan = !isMouse || e.button === 1 || e.button === 2;
    if (!canPan) return;
    e.preventDefault(); // suppress middle-click autoscroll / right-click quirks

    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Capture mouse pointers so the release is always delivered here — otherwise a
    // button let go off-window leaves a stale pointer that "pans" on plain moves.
    if (isMouse) {
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // Safety net: a mouse move with no button held means a pointerup was missed —
    // drop stale pointers so the image never pans while nothing is pressed.
    if (e.pointerType === "mouse" && e.buttons === 0 && pointers.current.size > 0) {
      pointers.current.clear();
      pinchDist.current = 0;
      return;
    }
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setSmooth(false); // pinch must track the fingers instantly
      if (pinchDist.current > 0) zoomAt(dist / pinchDist.current, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinchDist.current = dist;
      moved.current = true;
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true;
    if (tRef.current.s > 1) {
      setSmooth(false); // pan must track the cursor instantly
      setT((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = 0;
    if (!moved.current && downOnEmpty.current) onClose(); // tap empty area = close
  };

  // Fullscreen the whole lightbox (so our custom control bar stays visible too).
  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  }, []);

  const isVideo = item.type === "video";
  const isAudio = item.type === "audio";

  return (
    <div
      ref={wrapRef}
      className={`absolute inset-0 z-40 select-none touch-none overflow-hidden bg-black transition-opacity duration-200 ${
        shown && !closing ? "opacity-100" : "opacity-0"
      } ${closing ? "pointer-events-none" : ""}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Video gets a dedicated player (frame zooms/pans, controls stay pinned).
          Images/audio use the shared stage: a reserved bottom band keeps the media
          centered above the info panel; zoom origin is the stage center. */}
      {isVideo ? (
        <VideoPlayer
          src={item.full}
          itemId={item.id}
          t={t}
          smooth={smooth}
          stageRef={stageRef}
          onFullscreen={toggleFullscreen}
        />
      ) : (
        <div ref={stageRef} className="absolute inset-x-0 top-0 bottom-36">
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center will-change-transform"
            style={{
              transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`,
              transformOrigin: "center center",
              transition: smooth ? "transform 140ms ease-out" : "none",
            }}
          >
            {isAudio ? (
              <div
                data-media
                key={item.id}
                className="pointer-events-auto flex flex-col items-center gap-5 rounded-lg bg-white/5 p-6 shadow-2xl"
              >
                {item.thumb ? (
                  <img
                    src={item.thumb}
                    alt={item.title ?? ""}
                    draggable={false}
                    className="max-h-[58vh] max-w-[80vw] select-none rounded-md object-contain"
                    style={{ WebkitUserDrag: "none" } as React.CSSProperties}
                  />
                ) : null}
                {item.title ? (
                  <div className="max-w-[80vw] truncate text-center text-sm text-white/80">
                    {item.title}
                  </div>
                ) : null}
                <audio src={item.full} controls autoPlay className="w-[min(80vw,520px)]" />
              </div>
            ) : (
              <img
                data-media
                key={item.id}
                src={item.full}
                alt={item.title ?? ""}
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                className="pointer-events-auto max-h-full max-w-[94vw] select-none rounded-lg object-contain shadow-2xl"
                style={{ WebkitUserDrag: "none" } as React.CSSProperties}
              />
            )}
          </div>
        </div>
      )}

      <button
        data-control
        onClick={onClose}
        className="absolute left-4 top-4 z-10 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white backdrop-blur hover:bg-white/20"
      >
        ← Back
      </button>

      {/* Toggle the info panel (title/path/date) on/off. */}
      <button
        data-control
        onClick={() => setShowInfo((v) => !v)}
        aria-pressed={showInfo}
        title={showInfo ? "Hide info" : "Show info"}
        className={`absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur transition ${
          showInfo ? "bg-white/25 text-white" : "bg-white/10 text-white/70 hover:bg-white/20"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" strokeLinecap="round" />
          <circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      </button>

      <Arrow side="left" onClick={onPrev} />
      <Arrow side="right" onClick={onNext} />

      {/* Info panel sits in the reserved bottom band → never overlaps the media.
          For video it rides above the custom control bar. Toggle via the ⓘ button. */}
      {showInfo && (
      <div
        data-control
        className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center px-20 ${
          isVideo ? "bottom-[4.5rem]" : "bottom-5"
        }`}
      >
        <div className="pointer-events-auto max-h-24 max-w-[70vw] overflow-y-auto rounded-2xl bg-black/70 px-5 py-2 text-center backdrop-blur ring-1 ring-white/10">
          <div className="text-sm font-medium text-white [overflow-wrap:anywhere]">
            {item.title || "Untitled"}
          </div>
          {item.path && (
            <button
              type="button"
              title="Click to copy path"
              onClick={() => navigator.clipboard?.writeText(item.path ?? "")}
              className="block w-full text-xs text-white/55 [overflow-wrap:anywhere] hover:text-white/80"
            >
              {item.path}
            </button>
          )}
          <div className="text-xs text-white/40">
            {index + 1} / {total}
            {item.date ? ` · ${new Date(item.date).toLocaleDateString()}` : ""}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

function Arrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      data-control
      onClick={onClick}
      aria-label={side === "left" ? "Previous" : "Next"}
      className={`absolute top-1/2 z-10 flex h-16 w-16 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-4xl text-white/80 backdrop-blur transition hover:bg-black/60 hover:text-white ${
        side === "left" ? "left-4" : "right-4"
      }`}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
