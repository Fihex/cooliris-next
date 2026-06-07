import { useRef, useState } from "react";

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
  search: string;
  fromDate: string;
  toDate: string;
  onOpen: () => void;
  onSearch: (q: string) => void;
  onFromDate: (d: string) => void;
  onToDate: (d: string) => void;
  onToggleSlideshow: () => void;
  onOpenSettings: () => void;
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
      <Btn onClick={props.onFullscreen}>Fullscreen</Btn>

      <div className="ml-auto flex items-center gap-2">
        <Btn onClick={props.onOpenSettings}>⚙ Settings</Btn>
        <DatesMenu
          from={props.fromDate}
          to={props.toDate}
          onFrom={props.onFromDate}
          onTo={props.onToDate}
        />

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

/** A date input you can BOTH type (YYYY-MM-DD) and pick from a calendar. */
function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        value={value}
        placeholder="YYYY-MM-DD"
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-white/10 px-2 py-1.5 pr-9 text-white placeholder-white/30 outline-none ring-white/20 focus:ring-2"
      />
      <button
        type="button"
        aria-label="Pick a date"
        onClick={() => {
          const el = picker.current;
          if (!el) return;
          if (el.showPicker) el.showPicker();
          else el.focus();
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 py-0.5 text-white/60 hover:text-white"
      >
        📅
      </button>
      {/* Hidden native date input — only used to open the calendar picker. */}
      <input
        ref={picker}
        type="date"
        value={ymd}
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onChange(e.target.value)}
        className="pointer-events-none absolute right-2 top-1/2 h-px w-px -translate-y-1/2 opacity-0 [color-scheme:dark]"
      />
    </div>
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
          <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-xl bg-neutral-900 p-3 text-sm shadow-2xl ring-1 ring-white/10">
            <label className="mb-1 block text-xs text-white/50">From</label>
            <div className="mb-3">
              <DateField value={from} onChange={onFrom} />
            </div>
            <label className="mb-1 block text-xs text-white/50">To</label>
            <DateField value={to} onChange={onTo} />
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                onClick={() => {
                  onFrom("");
                  onTo("");
                }}
                disabled={!active}
                className="rounded-lg bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear dates
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg bg-white px-3 py-1 text-xs font-medium text-black hover:bg-white/90"
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
