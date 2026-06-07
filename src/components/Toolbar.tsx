import { useState } from "react";

export interface LoadProgress {
  loaded: number;
  total: number;
  pending: number;
}

interface ToolbarProps {
  title?: string;
  count: number;
  busy: boolean;
  progress: LoadProgress;
  slideshow: boolean;
  titles: boolean;
  search: string;
  fromDate: string;
  toDate: string;
  onOpen: () => void;
  onSearch: (q: string) => void;
  onFromDate: (d: string) => void;
  onToDate: (d: string) => void;
  onToggleSlideshow: () => void;
  onToggleTitles: () => void;
  onFullscreen: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const stillLoading = props.busy || props.progress.pending > 0;

  return (
    <header className="pointer-events-auto absolute left-0 right-0 top-0 z-20 flex flex-wrap items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
      <div className="mr-2 flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tracking-tight">Cooliris</span>
        <span className="text-lg font-light text-white/50">Next</span>
      </div>

      <Btn onClick={props.onOpen}>Open</Btn>

      <div className="mx-1 h-5 w-px bg-white/15" />

      <Btn onClick={props.onToggleSlideshow} active={props.slideshow}>
        {props.slideshow ? "Stop" : "Slideshow"}
      </Btn>
      <Btn onClick={props.onToggleTitles} active={props.titles}>
        Titles
      </Btn>
      <DatesMenu
        from={props.fromDate}
        to={props.toDate}
        onFrom={props.onFromDate}
        onTo={props.onToDate}
      />
      <Btn onClick={props.onFullscreen}>Fullscreen</Btn>

      <div className="ml-auto flex items-center gap-3">
        {/* Search */}
        <div className="relative">
          <input
            value={props.search}
            onChange={(e) => props.onSearch(e.target.value)}
            placeholder="Search…"
            className="w-40 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white placeholder-white/40 outline-none ring-white/20 focus:ring-2 sm:w-52"
          />
          {props.search && (
            <button
              onClick={() => props.onSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm text-white/60">
          {stillLoading && <Spinner />}
          {props.progress.total > 0 && (
            <span>
              {props.progress.loaded}/{props.progress.total}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

/** Date-range filter popover (filters by file last-modified date). */
function DatesMenu({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  onFrom: (d: string) => void;
  onTo: (d: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = !!(from || to);
  return (
    <div className="relative">
      <Btn onClick={() => setOpen((o) => !o)} active={active || open}>
        Dates{active ? " •" : ""}
      </Btn>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-xl bg-neutral-900 p-3 text-sm shadow-2xl ring-1 ring-white/10">
            <label className="mb-1 block text-xs text-white/50">From</label>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => onFrom(e.target.value)}
              className="mb-3 w-full rounded-lg bg-white/10 px-2 py-1.5 text-white outline-none ring-white/20 focus:ring-2 [color-scheme:dark]"
            />
            <label className="mb-1 block text-xs text-white/50">To</label>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => onTo(e.target.value)}
              className="w-full rounded-lg bg-white/10 px-2 py-1.5 text-white outline-none ring-white/20 focus:ring-2 [color-scheme:dark]"
            />
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => {
                  onFrom("");
                  onTo("");
                }}
                className="text-xs text-white/50 hover:text-white"
              >
                Clear
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg bg-white/15 px-3 py-1 text-xs font-medium hover:bg-white/25"
              >
                Done
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-tight text-white/35">
              Filters by file last-modified date (browsers don't expose created date).
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Btn({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
        active ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
  );
}
