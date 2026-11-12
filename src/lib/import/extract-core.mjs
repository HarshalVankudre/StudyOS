/**
 * The document parsing behind src/lib/import/extract.ts: PDF (PDF.js via
 * unpdf), Word .docx and plain text.
 *
 * Production code runs this ONLY inside the extraction child process
 * (extract-child.mjs), which extract.ts starts with a memory cap, a kill
 * timer and a per-instance concurrency limit. Nothing here may assume it is
 * protected by those, though: every scan is linear in its input, and every
 * decompression is measured before anything trusts it.
 *
 * Plain JavaScript (types in extract-core.d.mts) because the child is started
 * by Node directly, outside Next's bundler, in the standalone server and in
 * the tests alike. It must not import TypeScript or path aliases. All limits
 * come in from the caller (extract.ts owns the numbers).
 */
import { Unzip, UnzipInflate, Unzlib } from "fflate";

/** Feed decompressors this much compressed input at a time. */
const INFLATE_CHUNK = 16 * 1024;

export class ExtractError extends Error {
  /**
   * @param {import("./extract-core.d.mts").ExtractErrorCode} code
   * @param {string} [detail]
   * @param {import("./extract-core.d.mts").SourceKind} [kind]
   */
  constructor(code, detail, kind) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ExtractError";
    this.code = code;
    this.kind = kind;
  }
}

/** Decide the file kind from its leading bytes (the name/MIME only break ties). */
export function detectSourceKind(bytes, fileName, mimeType) {
  const name = String(fileName).toLowerCase();
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  if (head.includes("%PDF-")) return "pdf";
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (isZip) {
    return name.endsWith(".docx") || String(mimeType).includes("wordprocessingml") ? "docx" : null;
  }
  // Legacy binary .doc (OLE) and anything else binary is not supported.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return null;
  if (/\.(txt|md|markdown|text)$/.test(name) || String(mimeType).startsWith("text/")) return "text";
  return null;
}

// ---------------------------------------------------------------------------
// Whitespace (linear)
// ---------------------------------------------------------------------------

const isBlank = (code) => code === 0x20 || code === 0x09 || code === 0xa0;
const isTab = (code) => code === 0x09;

/**
 * Remove the characters `strip` accepts from the end of every line.
 * Equivalent to `text.replace(/[ \t ]+\n/g, "\n")` (for isBlank), but
 * linear: that regex restarts at every blank of a long run with no newline,
 * which is quadratic (200 KB of spaces blocked for 17 s).
 */
export function stripLineEnds(text, strip = isBlank) {
  const parts = [];
  let lineStart = 0;
  for (;;) {
    const newline = text.indexOf("\n", lineStart);
    if (newline === -1) {
      parts.push(text.slice(lineStart));
      break;
    }
    let end = newline;
    while (end > lineStart && strip(text.charCodeAt(end - 1))) end -= 1;
    parts.push(text.slice(lineStart, end), "\n");
    lineStart = newline + 1;
  }
  return parts.join("");
}

/** Normalize line breaks, drop trailing blanks, collapse blank-line runs. */
export function tidy(text) {
  return stripLineEnds(text.replace(/\f/g, "\n").replace(/\r\n?/g, "\n"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Non-whitespace characters, counted without building a copy. */
function meaningfulChars(text, enough) {
  let count = 0;
  for (let i = 0; i < text.length && count < enough; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0x20 && code !== 0xa0 && code !== 0x85 && code !== 0x2028 && code !== 0x2029 && code !== 0xfeff) {
      count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

function decodeText(bytes) {
  let text;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = new TextDecoder("utf-16le").decode(bytes.subarray(2));
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = new TextDecoder("utf-16be").decode(bytes.subarray(2));
  } else {
    text = new TextDecoder("utf-8").decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  }
  // Lots of NULs means this was a binary file with a text-looking name.
  let nulCount = 0;
  const head = Math.min(text.length, 4096);
  for (let i = 0; i < head; i += 1) if (text.charCodeAt(i) === 0) nulCount += 1;
  if (nulCount > 8) throw new ExtractError("unsupported", "binary content");
  return text;
}

// ---------------------------------------------------------------------------
// .docx
// ---------------------------------------------------------------------------

/**
 * Inflate one entry of a zip, refusing to produce more than `maxBytes`.
 * Returns null when the entry is missing. Throws too_large past the cap and
 * unreadable on a corrupt or encrypted archive.
 */
export function readZipEntry(bytes, entryName, maxBytes) {
  const chunks = [];
  let size = 0;
  let found = false;
  let finished = false;
  let overflow = false;
  let failure = null;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (file.name !== entryName || found) return;
    found = true;
    file.ondata = (error, data, final) => {
      if (overflow || failure) return;
      if (error) {
        failure = error;
        return;
      }
      size += data.length;
      if (size > maxBytes) {
        overflow = true;
        try {
          file.terminate();
        } catch {
          // Already stopped.
        }
        return;
      }
      chunks.push(data);
      if (final) finished = true;
    };
    try {
      file.start();
    } catch (error) {
      failure = error;
    }
  };

  try {
    for (let offset = 0; offset < bytes.length; offset += INFLATE_CHUNK) {
      if (overflow || failure || finished) break;
      const end = Math.min(offset + INFLATE_CHUNK, bytes.length);
      unzip.push(bytes.subarray(offset, end), end === bytes.length);
    }
  } catch (error) {
    if (!overflow) failure = error;
  }

  if (overflow) throw new ExtractError("too_large", "document expands beyond the limit");
  if (failure) throw new ExtractError("unreadable", String(failure));
  if (!found) return null;
  if (!finished) throw new ExtractError("unreadable", "truncated archive");
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function decodeXmlEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (_, entity) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const code =
          entity[1] === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
    }
  });
}

const TAG_NAME = /^[A-Za-z0-9_:.-]+/;

/**
 * Text of a WordprocessingML body: runs (`w:t`) in reading order, tabs and
 * line breaks kept, paragraphs and table rows on new lines, table cells
 * separated by tabs (so a grading table stays "Midterm<TAB>25%"). Page breaks
 * (hard breaks and the ones Word recorded when it last laid the document out)
 * become form feeds, so callers that care about pages can split on them.
 *
 * One forward walk with indexOf: each tag is the text from a `<` to the next
 * `>`. A `<` with no `>` after it ends the walk (nothing after it can be
 * markup). The old `/<[^>]*>/g` scan retried from every `<` of such a run,
 * which made a 400-byte upload block the server for 14 seconds. Everything
 * emitted counts toward the `maxChars * 2` stop, tabs and breaks included.
 */
export function docxXmlToText(xml, maxChars) {
  const out = [];
  let length = 0;
  const push = (piece) => {
    out.push(piece);
    length += piece.length;
  };
  let inText = false;
  let cellDepth = 0;
  let cursor = 0;
  while (cursor < xml.length && length <= maxChars * 2) {
    const open = xml.indexOf("<", cursor);
    if (open === -1) break;
    const close = xml.indexOf(">", open + 1);
    if (close === -1) break;
    if (inText && open > cursor) push(decodeXmlEntities(xml.slice(cursor, open)));
    cursor = close + 1;

    const closing = xml.charCodeAt(open + 1) === 0x2f; // "/"
    const selfClosing = xml.charCodeAt(close - 1) === 0x2f;
    const nameStart = open + (closing ? 2 : 1);
    const name = xml.slice(nameStart, Math.min(close, nameStart + 64)).match(TAG_NAME)?.[0] ?? "";
    switch (name) {
      case "w:t":
        inText = !closing && !selfClosing;
        break;
      case "w:tab":
        if (!closing) push("\t");
        break;
      case "w:br":
      case "w:cr":
        if (!closing) {
          // Plain substring tests on the tag text (untrusted, possibly huge).
          const tag = xml.slice(open, close + 1);
          push(tag.includes('w:type="page"') || tag.includes("w:type='page'") ? "\f" : "\n");
        }
        break;
      case "w:lastRenderedPageBreak":
        if (!closing) push("\f");
        break;
      case "w:p":
        // Inside a table cell, paragraphs join with a space so a row stays on one line.
        if (closing) push(cellDepth > 0 ? " " : "\n");
        break;
      case "w:tc":
        if (selfClosing) break;
        if (closing) {
          cellDepth = Math.max(0, cellDepth - 1);
          push("\t");
        } else {
          cellDepth += 1;
        }
        break;
      case "w:tr":
        if (closing) push("\n");
        break;
      default:
        break;
    }
  }
  // " \t" -> "\t", then tabs at line ends dropped (linear, see stripLineEnds).
  return stripLineEnds(out.join("").replace(/ \t/g, "\t"), isTab);
}

/**
 * Split .docx text at its page breaks (form feeds from docxXmlToText). Breaks
 * with nothing but whitespace between them count once: Word often records a
 * hard page break and the rendered break right after it.
 */
function splitDocxPages(text) {
  const pages = text.split("\f");
  const out = [];
  for (const page of pages) {
    if (out.length > 0 && page.trim() === "") continue;
    out.push(page);
  }
  // A leading break (document starting on a new page) leaves an empty first page.
  if (out.length > 1 && out[0].trim() === "") out.shift();
  return out;
}

// ---------------------------------------------------------------------------
// PDF decompression bombs
// ---------------------------------------------------------------------------

class Overflow extends Error {}

/** Counts decoded bytes against one budget shared by every stream of a file. */
class Budget {
  constructor(max) {
    this.max = max;
    this.used = 0;
  }
  add(n) {
    this.used += n;
    if (this.used > this.max) throw new Overflow();
  }
}

/**
 * A push stage writes decoded bytes through this: a fixed buffer flushed
 * downstream when full, so no stage ever holds more than one block.
 */
function emitter(next) {
  const block = new Uint8Array(64 * 1024);
  let filled = 0;
  return {
    byte(value) {
      block[filled++] = value;
      if (filled === block.length) this.flush(false);
    },
    flush(final) {
      next(block.slice(0, filled), final);
      filled = 0;
    },
  };
}

const hexValue = (c) =>
  c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1;

/** ASCIIHexDecode. */
function hexStage(next) {
  const out = emitter(next);
  let high = -1;
  let done = false;
  return (chunk, final) => {
    for (let i = 0; i < chunk.length && !done; i += 1) {
      if (chunk[i] === 0x3e) {
        done = true;
        break;
      }
      const v = hexValue(chunk[i]);
      if (v < 0) continue;
      if (high < 0) {
        high = v;
      } else {
        out.byte((high << 4) | v);
        high = -1;
      }
    }
    if ((final || done) && high >= 0) {
      out.byte(high << 4);
      high = -1;
    }
    out.flush(final);
  };
}

/** ASCII85Decode. */
function a85Stage(next) {
  const out = emitter(next);
  const group = [];
  let done = false;
  const flushGroup = (count) => {
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const digit of group) v = v * 85 + digit;
    for (let k = 0; k < count; k += 1) out.byte(Math.floor(v / 2 ** (24 - 8 * k)) & 255);
    group.length = 0;
  };
  return (chunk, final) => {
    for (let i = 0; i < chunk.length && !done; i += 1) {
      const c = chunk[i];
      if (c === 0x7e) {
        done = true;
        break;
      }
      if (c === 0x7a && group.length === 0) {
        for (let k = 0; k < 4; k += 1) out.byte(0);
        continue;
      }
      if (c < 0x21 || c > 0x75) continue;
      group.push(c - 0x21);
      if (group.length === 5) flushGroup(4);
    }
    if ((final || done) && group.length > 1) flushGroup(group.length - 1);
    out.flush(final);
  };
}

/** RunLengthDecode. */
function runLengthStage(next) {
  const out = emitter(next);
  let repeatFrom = -1;
  let literalLeft = 0;
  let done = false;
  return (chunk, final) => {
    for (let i = 0; i < chunk.length && !done; i += 1) {
      const c = chunk[i];
      if (literalLeft > 0) {
        out.byte(c);
        literalLeft -= 1;
      } else if (repeatFrom >= 0) {
        for (let k = 0; k < 257 - repeatFrom; k += 1) out.byte(c);
        repeatFrom = -1;
      } else if (c === 128) {
        done = true;
      } else if (c < 128) {
        literalLeft = c + 1;
      } else {
        repeatFrom = c;
      }
    }
    out.flush(final);
  };
}

/**
 * LZWDecode with EarlyChange 1, following PDF.js's LZWStream (a code past
 * the table repeats the previous string plus its first byte, as PDF.js does).
 */
function lzwStage(next) {
  const out = emitter(next);
  const SIZE = 4096;
  const prefix = new Int32Array(SIZE + 1);
  const suffix = new Uint8Array(SIZE + 1);
  const lengths = new Int32Array(SIZE + 1);
  for (let i = 0; i < 256; i += 1) {
    prefix[i] = -1;
    suffix[i] = i;
    lengths[i] = 1;
  }
  const current = new Uint8Array(SIZE + 1);
  let currentLength = 0;
  let nextCode = 258;
  let codeLength = 9;
  let previous = -1;
  let bits = 0;
  let bitCount = 0;
  let done = false;
  return (chunk, final) => {
    for (let i = 0; i < chunk.length && !done; i += 1) {
      bits = ((bits << 8) | chunk[i]) & 0xffffff;
      bitCount += 8;
      while (bitCount >= codeLength && !done) {
        const code = (bits >>> (bitCount - codeLength)) & ((1 << codeLength) - 1);
        bitCount -= codeLength;
        const hadPrevious = currentLength > 0;
        if (code < 256) {
          current[0] = code;
          currentLength = 1;
        } else if (code >= 258) {
          if (code < nextCode && code < SIZE) {
            currentLength = lengths[code];
            for (let j = currentLength - 1, q = code; j >= 0; j -= 1) {
              current[j] = suffix[q];
              q = prefix[q];
            }
          } else if (currentLength < SIZE) {
            current[currentLength] = current[0];
            currentLength += 1;
          }
        } else if (code === 256) {
          codeLength = 9;
          nextCode = 258;
          currentLength = 0;
          previous = -1;
          continue;
        } else {
          done = true;
          break;
        }
        if (hadPrevious && previous >= 0 && nextCode < SIZE) {
          prefix[nextCode] = previous;
          lengths[nextCode] = lengths[previous] + 1;
          suffix[nextCode] = current[0];
        }
        if (hadPrevious) {
          nextCode += 1;
          if (((nextCode + 1) & nextCode) === 0) {
            codeLength = Math.min(Math.floor(Math.log2(nextCode + 1)) + 1, 12);
          }
        }
        previous = code < nextCode ? code : -1;
        for (let k = 0; k < currentLength; k += 1) out.byte(current[k]);
      }
    }
    out.flush(final);
  };
}

/** FlateDecode: a zlib stream with any window size, as PDF.js accepts. */
function flateStage(next) {
  let failed = false;
  const inflater = new Unzlib((data, final) => next(data, final));
  return (chunk, final) => {
    if (failed) return;
    try {
      inflater.push(chunk, final);
    } catch (error) {
      if (error instanceof Overflow) throw error;
      // Corrupt data: PDF.js stops reading this stream at the same point.
      failed = true;
    }
  };
}

const STAGES = {
  FlateDecode: flateStage,
  Fl: flateStage,
  ASCIIHexDecode: hexStage,
  AHx: hexStage,
  ASCII85Decode: a85Stage,
  A85: a85Stage,
  LZWDecode: lzwStage,
  LZW: lzwStage,
  RunLengthDecode: runLengthStage,
  RL: runLengthStage,
};

/**
 * The filter chain of a stream dictionary: its names, [] for no /Filter, or
 * null when /Filter is there but not written as names (an indirect
 * reference PDF.js would resolve).
 */
function streamFilters(dictionary) {
  const at = dictionary.lastIndexOf("/Filter");
  if (at === -1) return [];
  const rest = dictionary.slice(at + 7, at + 7 + 600);
  const match = /^\s*(\[[^\]]*\]|\/[A-Za-z0-9#]{1,64})/.exec(rest);
  if (!match) return null;
  const names = match[1].match(/\/[A-Za-z0-9#]{1,64}/g) ?? [];
  if (match[1].startsWith("[") && /\bR\b/.test(match[1])) return null;
  return names.map((name) => name.slice(1));
}

/** True when `data` starts with a zlib header PDF.js's FlateStream accepts. */
function looksLikeZlib(data) {
  return (
    data.length >= 2 &&
    (data[0] & 0x0f) === 8 &&
    data[0] >> 4 <= 7 &&
    ((data[0] << 8) | data[1]) % 31 === 0 &&
    (data[1] & 0x20) === 0
  );
}

/**
 * Feed one stream through its filter chain, counting every stage's output
 * against the budget (PDF.js keeps each stage's whole output). Image-only
 * filters (DCT, JPX, JBIG2, CCITT) end the chain: text extraction never
 * decodes them.
 */
function measureStream(data, filters, budget) {
  const chain = [];
  for (const name of filters ?? (looksLikeZlib(data) ? ["FlateDecode"] : [])) {
    const stage = STAGES[name];
    if (!stage) break;
    chain.push(stage);
  }
  if (chain.length === 0) return;
  let sink = (chunk) => budget.add(chunk.length);
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const downstream = sink;
    const counted =
      i === chain.length - 1
        ? downstream
        : (chunk, final) => {
            budget.add(chunk.length);
            downstream(chunk, final);
          };
    sink = chain[i](counted);
  }
  if (data.length === 0) {
    sink(new Uint8Array(0), true);
    return;
  }
  for (let offset = 0; offset < data.length; offset += INFLATE_CHUNK) {
    const end = Math.min(offset + INFLATE_CHUNK, data.length);
    sink(data.subarray(offset, end), end === data.length);
  }
}

/**
 * Refuse PDFs whose streams would decode past `maxBytes` in total
 * (decompression bombs). Every stream is measured through its declared
 * filter chain (Flate with any window size, ASCIIHex, ASCII85, LZW and
 * RunLength, in any combination) whatever its first byte; a stream with no
 * `endstream` is measured to the end of the file; a /Filter given by
 * reference is assumed to be Flate when the data looks like zlib. Linear in
 * the file size: a dictionary is read from a bounded window that never
 * reaches back past the previous stream.
 *
 * This is the friendly early refusal. The guarantee is the memory cap on the
 * extraction process (extract.ts): an encrypted bomb, for one, can only be
 * measured after decryption, which is PDF.js's job.
 */
export function assertPdfStreamsBounded(bytes, maxBytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const budget = new Budget(maxBytes);
  let position = 0;
  try {
    while (position < buf.length) {
      const keyword = buf.indexOf("stream", position, "latin1");
      if (keyword === -1) return;
      if (keyword >= 3 && buf.toString("latin1", keyword - 3, keyword) === "end") {
        position = keyword + 6;
        continue;
      }
      // The stream's own dictionary: after the last "obj" (its header, or the
      // previous object's endobj) within a bounded window.
      let dictionary = buf.toString("latin1", Math.max(position, keyword - 4096), keyword);
      const objAt = dictionary.lastIndexOf("obj");
      if (objAt !== -1) dictionary = dictionary.slice(objAt + 3);
      let start = keyword + 6;
      if (buf[start] === 0x0d) start += 1;
      if (buf[start] === 0x0a) start += 1;
      let end = buf.indexOf("endstream", start, "latin1");
      if (end === -1) end = buf.length;
      measureStream(buf.subarray(start, end), streamFilters(dictionary), budget);
      position = end + 9;
    }
  } catch (error) {
    if (error instanceof Overflow) throw new ExtractError("too_large", "PDF expands beyond the limit");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// PDF text
// ---------------------------------------------------------------------------

async function extractPdf(bytes, deadline, limits) {
  if (!limits.skipPdfPrecheck) assertPdfStreamsBounded(bytes, limits.maxPdfInflatedBytes);

  const { getResolvedPDFJS } = await import("unpdf");
  const pdfjs = await getResolvedPDFJS();
  // PDF.js may transfer (detach) the buffer it is given, so hand it a copy.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    // No font/CMap/wasm locations: PDF.js never reads files or the network.
    useSystemFonts: false,
    disableFontFace: true,
    useWasm: false,
    enableXfa: false,
    isEvalSupported: false,
    stopAtErrors: false,
    isOffscreenCanvasSupported: false,
    verbosity: 0,
  });

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ExtractError("timeout")), Math.max(0, deadline - Date.now()));
  });

  const work = (async () => {
    let document;
    try {
      document = await task.promise;
    } catch (error) {
      // Password-protected, damaged, or not really a PDF.
      throw new ExtractError("unreadable", error instanceof Error ? error.name : "load failed");
    }
    const pages = document.numPages;
    const readPages = Math.min(pages, limits.maxPdfPages);
    const parts = [];
    let length = 0;
    for (let number = 1; number <= readPages; number += 1) {
      if (Date.now() > deadline) throw new ExtractError("timeout");
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => (item.str ?? "") + (item.hasEOL ? "\n" : ""))
        .join("");
      page.cleanup();
      parts.push(pageText);
      length += pageText.length;
      if (length > limits.maxChars * 2) break;
    }
    return { pageTexts: parts, pages, pagesRead: readPages, pagesTruncated: pages > readPages };
  })();

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    // Always release PDF.js resources (also stops work after a timeout).
    void task.destroy().catch(() => {});
    work.catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Entry points (called in the child with fully resolved limits)
// ---------------------------------------------------------------------------

async function extractRaw(bytes, fileName, mimeType, limits) {
  if (bytes.byteLength === 0) throw new ExtractError("no_text", "empty file");
  if (bytes.byteLength > limits.maxBytes) throw new ExtractError("too_large");
  const kind = detectSourceKind(bytes, fileName, mimeType);
  if (!kind) throw new ExtractError("unsupported");

  if (kind === "pdf") {
    const { pageTexts, ...pdfInfo } = await extractPdf(bytes, limits.deadline, limits);
    return { kind, pages: pageTexts, paginated: true, pdfInfo };
  }
  if (kind === "docx") {
    const xml = readZipEntry(bytes, "word/document.xml", limits.maxDocxXmlBytes);
    if (xml === null) throw new ExtractError("unreadable", "no word/document.xml");
    const pages = splitDocxPages(docxXmlToText(new TextDecoder("utf-8").decode(xml), limits.maxChars));
    return { kind, pages, paginated: pages.length > 1, pdfInfo: {} };
  }
  return { kind, pages: [decodeText(bytes)], paginated: false, pdfInfo: {} };
}

/** extractSourceText's result: the whole text, capped at `maxChars`. */
async function extractText(bytes, fileName, mimeType, limits) {
  const { kind, pages, pdfInfo } = await extractRaw(bytes, fileName, mimeType, limits);
  const text = tidy(pages.join("\n\n"));
  if (meaningfulChars(text, 20) < 20) {
    // A PDF with pages but no text layer is a scan (or images of text).
    throw new ExtractError("no_text", "no text layer", kind);
  }
  return { kind, text: text.slice(0, limits.maxChars), totalChars: text.length, ...pdfInfo };
}

/** extractSourcePages's result: tidied text page by page. */
async function extractPages(bytes, fileName, mimeType, limits) {
  const raw = await extractRaw(bytes, fileName, mimeType, limits);
  const maxChars = limits.maxChars;
  const pages = [];
  let totalChars = 0;
  let truncated = Boolean(raw.pdfInfo.pagesTruncated);
  for (const page of raw.pages) {
    const text = tidy(page);
    if (totalChars + text.length > maxChars) {
      const room = maxChars - totalChars;
      if (room > 200) pages.push(text.slice(0, room));
      truncated = true;
      break;
    }
    pages.push(text);
    totalChars += text.length;
  }
  totalChars = pages.reduce((sum, page) => sum + page.length, 0);
  let meaningful = 0;
  for (const page of pages) {
    meaningful += meaningfulChars(page, 20 - meaningful);
    if (meaningful >= 20) break;
  }
  if (meaningful < 20) throw new ExtractError("no_text", "no text layer", raw.kind);
  return {
    kind: raw.kind,
    pages,
    paginated: raw.paginated,
    totalChars,
    sourcePages: raw.pdfInfo.pages ?? (raw.paginated ? raw.pages.length : 1),
    truncated,
  };
}

/**
 * Run one extraction request and describe the outcome as plain data (it
 * crosses a process boundary). Never throws.
 */
export async function runExtraction(request) {
  try {
    const run = request.mode === "pages" ? extractPages : extractText;
    const value = await run(request.bytes, request.fileName, request.mimeType, request.limits);
    return { ok: true, value };
  } catch (error) {
    if (error instanceof ExtractError) {
      return { ok: false, code: error.code, detail: error.message, kind: error.kind };
    }
    return {
      ok: false,
      code: "internal",
      detail: error instanceof Error ? `${error.name}: ${error.message}` : typeof error,
    };
  }
}
