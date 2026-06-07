import type { Feed, JsonFeed, MediaItem } from "./types";

let autoId = 0;
const nextId = () => `item-${Date.now().toString(36)}-${autoId++}`;

/** Normalize a loosely-typed JSON record into a MediaItem. */
function normalizeItem(raw: unknown): MediaItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  // Accept a few common aliases so hand-written manifests are forgiving.
  const full =
    (r.full as string) ??
    (r.url as string) ??
    (r.src as string) ??
    (r.image as string) ??
    (r.content as string);
  const thumb =
    (r.thumb as string) ??
    (r.thumbnail as string) ??
    (r.preview as string) ??
    full;
  if (!full && !thumb) return null;

  const rawType = (r.type as string)?.toLowerCase();
  const looksVideo =
    rawType === "video" || /\.(mp4|webm|ogv|mov|m4v)(\?|$)/i.test(full ?? "");

  return {
    id: (r.id as string) ?? (r.guid as string) ?? nextId(),
    type: looksVideo ? "video" : "image",
    thumb: thumb ?? full,
    full: full ?? thumb,
    title: (r.title as string) ?? (r.name as string),
    path: (r.path as string) ?? undefined,
    link: (r.link as string) ?? (r.href as string),
    aspect: typeof r.aspect === "number" ? (r.aspect as number) : undefined,
  };
}

/** Parse a parsed-JSON value (array or `{items}`) into a Feed. */
export function parseJsonFeed(data: JsonFeed): Feed {
  const arr = Array.isArray(data) ? data : data.items;
  const title = Array.isArray(data) ? undefined : data.title;
  const items = (arr ?? [])
    .map(normalizeItem)
    .filter((i): i is MediaItem => i !== null);
  return { title, items };
}

/** Load and parse a JSON manifest from a URL. */
export async function loadJsonFeedFromUrl(url: string): Promise<Feed> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Failed to load feed (${res.status} ${res.statusText})`);
  }
  const data = (await res.json()) as JsonFeed;
  const feed = parseJsonFeed(data);
  if (feed.items.length === 0) throw new Error("Feed contained no media items.");
  return feed;
}

/** Parse a JSON manifest from a pasted string. */
export function loadJsonFeedFromText(text: string): Feed {
  const data = JSON.parse(text) as JsonFeed;
  const feed = parseJsonFeed(data);
  if (feed.items.length === 0) throw new Error("Feed contained no media items.");
  return feed;
}
