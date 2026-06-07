import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaItem } from "@/feed/types";

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
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const tRef = useRef(t);
  tRef.current = t;

  const [shown, setShown] = useState(false); // for fade-in
  const [smooth, setSmooth] = useState(false); // transition on for wheel, off for drag/pinch
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
      const r = wrapRef.current!.getBoundingClientRect();
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
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    // An empty-area press (not on the media or a control) can become a close-tap.
    downOnEmpty.current = !(e.target as HTMLElement).closest("[data-media],[data-control]");
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
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

  const isVideo = item.type === "video";

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
      {/* Full-size transform layer → origin is the FIXED viewport center, so
          zoom-to-cursor is stable (no drift/glitch). */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center will-change-transform"
        style={{
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`,
          transformOrigin: "center center",
          transition: smooth ? "transform 140ms ease-out" : "none",
        }}
      >
        {isVideo ? (
          <video
            data-media
            key={item.id}
            src={item.full}
            controls
            autoPlay
            draggable={false}
            className="pointer-events-auto max-h-[90vh] max-w-[94vw] rounded-lg object-contain shadow-2xl"
          />
        ) : (
          <img
            data-media
            key={item.id}
            src={item.full}
            alt={item.title ?? ""}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            className="pointer-events-auto max-h-[90vh] max-w-[94vw] select-none rounded-lg object-contain shadow-2xl"
            style={{ WebkitUserDrag: "none" } as React.CSSProperties}
          />
        )}
      </div>

      <button
        data-control
        onClick={onClose}
        className="absolute left-4 top-4 z-10 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white backdrop-blur hover:bg-white/20"
      >
        ← Back
      </button>

      <Arrow side="left" onClick={onPrev} />
      <Arrow side="right" onClick={onNext} />

      <div
        data-control
        className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-20"
      >
        <div className="max-h-32 max-w-[70vw] overflow-y-auto rounded-2xl bg-black/70 px-5 py-2 text-center backdrop-blur ring-1 ring-white/10">
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
