import { useRef } from "react";

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
  fsAccess: boolean;
  onOpenFiles: (files: File[]) => void;
  onOpenFilePicker: () => void;
  onOpenFolderPicker: () => void;
  onLoadUrl: (url: string) => void;
  onSearch: (q: string) => void;
  onToggleSlideshow: () => void;
  onToggleTitles: () => void;
  onFullscreen: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const promptUrl = () => {
    const url = window.prompt("Load a JSON manifest URL:", "/sample-feed.json");
    if (url) props.onLoadUrl(url.trim());
  };

  const stillLoading = props.busy || props.progress.pending > 0;

  return (
    <header className="pointer-events-auto absolute left-0 right-0 top-0 z-20 flex flex-wrap items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
      <div className="mr-2 flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tracking-tight">Cooliris</span>
        <span className="text-lg font-light text-white/50">Next</span>
      </div>

      {props.fsAccess ? (
        <>
          <Btn onClick={props.onOpenFilePicker}>Open files</Btn>
          <Btn onClick={props.onOpenFolderPicker}>Open folder</Btn>
        </>
      ) : (
        <>
          <Btn onClick={() => fileInput.current?.click()}>Open files</Btn>
          <Btn onClick={() => folderInput.current?.click()}>Open folder</Btn>
        </>
      )}
      <Btn onClick={promptUrl}>Load JSON URL</Btn>

      <div className="mx-1 h-5 w-px bg-white/15" />

      <Btn onClick={props.onToggleSlideshow} active={props.slideshow}>
        {props.slideshow ? "Stop" : "Slideshow"}
      </Btn>
      <Btn onClick={props.onToggleTitles} active={props.titles}>
        Titles
      </Btn>
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

      {/* Hidden fallback inputs for browsers without File System Access API. */}
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) props.onOpenFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        // @ts-expect-error non-standard but widely supported
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) props.onOpenFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
    </header>
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
