/** A single media item shown on the wall. */
export interface MediaItem {
  /** Stable unique id (guid). */
  id: string;
  /** "image" or "video". */
  type: "image" | "video";
  /** Thumbnail URL used for the wall tile. */
  thumb: string;
  /** Full-resolution image or video URL used in the detail view. */
  full: string;
  /** Display title. */
  title?: string;
  /** File path / location (relative path within an opened folder, or a URL). */
  path?: string;
  /** Timestamp (epoch ms) — file modified time, or a feed-provided date. */
  date?: number;
  /** Optional click-through link. */
  link?: string;
  /** Native aspect ratio (width / height), if known. Defaults to 1.5. */
  aspect?: number;
}

/** The shape of a JSON manifest file/URL. Either a bare array or `{ items: [...] }`. */
export type JsonFeed = MediaItem[] | { title?: string; items: MediaItem[] };

export interface Feed {
  title?: string;
  items: MediaItem[];
}
