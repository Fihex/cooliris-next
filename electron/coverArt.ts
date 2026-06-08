// Dependency-free embedded cover-art extractor for the common audio containers
// (MP3/ID3v2, FLAC, MP4/M4A, Ogg/Opus). Pure code → bundles cleanly into the main
// process (no ESM/dynamic-import/asar headaches). Leak-free: fs.readFile opens and
// closes the file itself; the partial-read fallback closes its handle in `finally`.

import { promises as fs } from "node:fs";

export interface Cover {
  mime: string;
  data: Buffer;
}

const FULL_READ_CAP = 48 * 1024 * 1024; // read whole file up to this; else just the head
const HEAD_BYTES = 8 * 1024 * 1024;

export async function extractCoverArt(abs: string): Promise<Cover | null> {
  let buf: Buffer;
  try {
    const st = await fs.stat(abs);
    buf = st.size <= FULL_READ_CAP ? await fs.readFile(abs) : await readHead(abs, HEAD_BYTES);
  } catch {
    return null;
  }
  try {
    if (buf.length >= 12) {
      if (buf.toString("latin1", 0, 3) === "ID3") return finalize(parseId3(buf));
      const tag4 = buf.toString("latin1", 0, 4);
      if (tag4 === "fLaC") return finalize(parseFlac(buf));
      if (tag4 === "OggS") return finalize(parseOgg(buf));
      if (buf.toString("latin1", 4, 8) === "ftyp") return finalize(parseMp4(buf));
    }
    // Magic missing → fall back to the extension.
    const ext = abs.slice(abs.lastIndexOf(".") + 1).toLowerCase();
    if (ext === "m4a" || ext === "mp4" || ext === "aac") return finalize(parseMp4(buf));
    if (ext === "ogg" || ext === "oga" || ext === "opus") return finalize(parseOgg(buf));
    if (ext === "flac") return finalize(parseFlac(buf));
    return null;
  } catch {
    return null;
  }
}

async function readHead(abs: string, n: number): Promise<Buffer> {
  const fh = await fs.open(abs, "r");
  try {
    const b = Buffer.alloc(n);
    const { bytesRead } = await fh.read(b, 0, n, 0);
    return b.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function finalize(c: Cover | null): Cover | null {
  if (!c || !c.data || c.data.length < 8) return null;
  if (!c.mime || !c.mime.includes("/")) c.mime = sniffMime(c.data);
  return c;
}

function sniffMime(d: Buffer): string {
  if (d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return "image/jpeg";
  if (d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return "image/png";
  if (d.toString("latin1", 0, 4) === "RIFF" && d.toString("latin1", 8, 12) === "WEBP")
    return "image/webp";
  if (d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46) return "image/gif";
  return "image/jpeg";
}

/* --------------------------------- MP3 / ID3v2 --------------------------------- */

function synchsafe(b: Buffer, o: number): number {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

function parseId3(buf: Buffer): Cover | null {
  const major = buf[3];
  const flags = buf[5];
  const tagSize = synchsafe(buf, 6);
  let pos = 10;
  const end = Math.min(buf.length, 10 + tagSize);
  if (flags & 0x40) {
    // Extended header — skip it.
    const extSize = major === 4 ? synchsafe(buf, pos) : buf.readUInt32BE(pos);
    pos += major === 4 ? extSize : extSize + 4;
  }
  while (pos + (major === 2 ? 6 : 10) <= end) {
    let id: string;
    let frameSize: number;
    let headerLen: number;
    if (major === 2) {
      id = buf.toString("latin1", pos, pos + 3);
      frameSize = (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5];
      headerLen = 6;
    } else {
      id = buf.toString("latin1", pos, pos + 4);
      frameSize = major === 4 ? synchsafe(buf, pos + 4) : buf.readUInt32BE(pos + 4);
      headerLen = 10;
    }
    if (!/^[A-Z0-9]{3,4}$/.test(id) || frameSize <= 0 || pos + headerLen + frameSize > end + 1) break;
    if (id === "APIC" || id === "PIC") {
      const c = parseApic(buf.subarray(pos + headerLen, pos + headerLen + frameSize), id);
      if (c) return c;
    }
    pos += headerLen + frameSize;
  }
  return null;
}

function parseApic(b: Buffer, id: string): Cover | null {
  let p = 0;
  const enc = b[p++];
  let mime = "";
  if (id === "PIC") {
    const fmt = b.toString("latin1", p, p + 3).toUpperCase();
    p += 3;
    mime = fmt.includes("PNG") ? "image/png" : "image/jpeg";
  } else {
    const z = b.indexOf(0, p);
    if (z < 0) return null;
    mime = b.toString("latin1", p, z);
    p = z + 1;
  }
  p++; // picture type byte
  // Description (encoding-dependent terminator).
  if (enc === 1 || enc === 2) {
    while (p + 1 < b.length && !(b[p] === 0 && b[p + 1] === 0)) p += 2;
    p += 2;
  } else {
    const z = b.indexOf(0, p);
    if (z < 0) return null;
    p = z + 1;
  }
  const data = b.subarray(p);
  return data.length ? { mime, data } : null;
}

/* ------------------------------------ FLAC ------------------------------------ */

function parseFlac(buf: Buffer): Cover | null {
  let pos = 4;
  while (pos + 4 <= buf.length) {
    const header = buf[pos];
    const last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const len = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    pos += 4;
    if (type === 6) return parseFlacPicture(buf.subarray(pos, pos + len));
    pos += len;
    if (last) break;
  }
  return null;
}

function parseFlacPicture(b: Buffer): Cover | null {
  if (b.length < 32) return null;
  let p = 4; // picture type
  const mimeLen = b.readUInt32BE(p);
  p += 4;
  const mime = b.toString("latin1", p, p + mimeLen);
  p += mimeLen;
  const descLen = b.readUInt32BE(p);
  p += 4 + descLen;
  p += 16; // width, height, depth, colors
  const dataLen = b.readUInt32BE(p);
  p += 4;
  const data = b.subarray(p, p + dataLen);
  return data.length ? { mime, data } : null;
}

/* --------------------------------- MP4 / M4A ---------------------------------- */

interface Box {
  start: number; // first byte of content
  end: number; // exclusive end of box
}

function parseMp4(buf: Buffer): Cover | null {
  const findBox = (from: number, to: number, name: string): Box | null => {
    let p = from;
    while (p + 8 <= to) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString("latin1", p + 4, p + 8);
      let header = 8;
      if (size === 1) {
        size = Number(buf.readBigUInt64BE(p + 8));
        header = 16;
      } else if (size === 0) {
        size = to - p;
      }
      if (size < header || p + size > to) break;
      if (type === name) return { start: p + header, end: p + size };
      p += size;
    }
    return null;
  };
  const moov = findBox(0, buf.length, "moov");
  if (!moov) return null;
  const udta = findBox(moov.start, moov.end, "udta");
  if (!udta) return null;
  const meta = findBox(udta.start, udta.end, "meta");
  if (!meta) return null;
  const ilst = findBox(meta.start + 4, meta.end, "ilst"); // meta is a fullbox (+4)
  if (!ilst) return null;
  const covr = findBox(ilst.start, ilst.end, "covr");
  if (!covr) return null;
  const data = findBox(covr.start, covr.end, "data");
  if (!data) return null;
  const typeIndicator = buf.readUInt32BE(data.start) & 0xff; // 13=jpeg, 14=png
  const img = buf.subarray(data.start + 8, data.end); // skip version/flags + reserved
  if (!img.length) return null;
  return { mime: typeIndicator === 14 ? "image/png" : "image/jpeg", data: img };
}

/* ------------------------------- Ogg / Opus ----------------------------------- */

function parseOgg(buf: Buffer): Cover | null {
  // Reassemble page payloads into one contiguous stream (strips page headers so a
  // picture split across pages is rejoined), capped so we don't scan huge files.
  const chunks: Buffer[] = [];
  let pos = 0;
  let total = 0;
  while (pos + 27 <= buf.length && buf.toString("latin1", pos, pos + 4) === "OggS") {
    const segs = buf[pos + 26];
    const tableEnd = pos + 27 + segs;
    if (tableEnd > buf.length) break;
    let dataLen = 0;
    for (let i = 0; i < segs; i++) dataLen += buf[pos + 27 + i];
    chunks.push(buf.subarray(tableEnd, tableEnd + dataLen));
    total += dataLen;
    pos = tableEnd + dataLen;
    if (total > 4 * 1024 * 1024) break; // comments live early
  }
  const stream = Buffer.concat(chunks);

  let cpos = -1;
  const opus = stream.indexOf("OpusTags", 0, "latin1");
  if (opus >= 0) cpos = opus + 8;
  else {
    const vorbis = stream.indexOf(Buffer.from([0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]));
    if (vorbis >= 0) cpos = vorbis + 7;
  }
  if (cpos < 0 || cpos + 4 > stream.length) return null;

  let p = cpos;
  const vendorLen = stream.readUInt32LE(p);
  p += 4 + vendorLen;
  if (p + 4 > stream.length) return null;
  const count = stream.readUInt32LE(p);
  p += 4;
  for (let i = 0; i < count && p + 4 <= stream.length; i++) {
    const len = stream.readUInt32LE(p);
    p += 4;
    const comment = stream.subarray(p, p + len);
    p += len;
    const eq = comment.indexOf(0x3d); // '='
    if (eq < 0) continue;
    if (comment.toString("latin1", 0, eq).toUpperCase() === "METADATA_BLOCK_PICTURE") {
      const pic = Buffer.from(comment.toString("latin1", eq + 1), "base64");
      const c = parseFlacPicture(pic);
      if (c) return c;
    }
  }
  return null;
}
