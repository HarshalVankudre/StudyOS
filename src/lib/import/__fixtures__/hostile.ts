/**
 * Hostile inputs measured in the wave-1 security review (probe scripts in the
 * review's pdftest folder), kept as regression fixtures: a tiny .docx whose
 * XML is a long run of `<`, text that is one long run of spaces, and PDF
 * decompression bombs that slipped past the old pre-check (a small deflate
 * window, a filter chain, no `endstream`), plus a few more filter shapes.
 */
import { createDeflate, deflateSync } from "node:zlib";
import { strToU8, zipSync } from "fflate";

const TEXT_OP = "BT /F1 12 Tf 72 700 Td (Midterm exam 25 percent, final exam 40 percent) Tj ET\n";

/** A one-page PDF whose content stream (object 4) is `stream` with `dictionary` entries. */
export function pdfWithContent(
  stream: Uint8Array,
  dictionary: string,
  options: { endstream?: boolean; extraObjects?: string[] } = {},
): Uint8Array {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets: number[] = [];
  const size = () => parts.reduce((n, p) => n + p.length, 0);
  const add = (b: Buffer) => {
    offsets.push(size());
    parts.push(b);
  };
  add(Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n", "latin1"));
  add(Buffer.from("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n", "latin1"));
  add(
    Buffer.from(
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
      "latin1",
    ),
  );
  add(
    Buffer.concat([
      Buffer.from(`4 0 obj\n<< /Length ${stream.length} ${dictionary} >>\nstream\n`, "latin1"),
      Buffer.from(stream),
      Buffer.from(options.endstream === false ? "\n" : "\nendstream\nendobj\n", "latin1"),
    ]),
  );
  add(Buffer.from("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n", "latin1"));
  (options.extraObjects ?? []).forEach((body, index) =>
    add(Buffer.from(`${6 + index} 0 obj\n${body}\nendobj\n`, "latin1")),
  );
  const xrefAt = size();
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * zlib data of a real text operator followed by `inflatedBytes` of spaces,
 * compressed chunk by chunk so the raw content never sits in memory.
 */
export function spacesDeflated(inflatedBytes: number, windowBits = 15): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const deflate = createDeflate({ level: 9, windowBits });
    const out: Buffer[] = [];
    deflate.on("data", (chunk: Buffer) => out.push(chunk));
    deflate.on("end", () => resolve(Buffer.concat(out)));
    deflate.on("error", reject);
    deflate.write(Buffer.from(TEXT_OP, "latin1"));
    const chunk = Buffer.alloc(1 << 20, 0x20);
    let left = inflatedBytes;
    const pump = () => {
      while (left > 0) {
        const piece = left >= chunk.length ? chunk : chunk.subarray(0, left);
        left -= piece.length;
        if (!deflate.write(piece)) {
          deflate.once("drain", pump);
          return;
        }
      }
      deflate.end();
    };
    pump();
  });
}

/** The review's .docx: a few hundred bytes whose document.xml is a long run of `<`. */
export function unclosedTagDocx(lessThans: number): Uint8Array {
  const xml = "<w:document><w:body><w:p><w:r><w:t>" + "<".repeat(lessThans);
  return zipSync({ "word/document.xml": strToU8(xml) }, { level: 9 });
}

/** A .docx made of many tab elements and no line break (a long tab run). */
export function tabRunDocx(tabs: number): Uint8Array {
  const xml =
    "<w:document><w:body><w:p><w:r><w:t>Course CS 101 data structures syllabus</w:t>" +
    "<w:tab/>".repeat(tabs) +
    "</w:r>";
  return zipSync({ "word/document.xml": strToU8(xml) }, { level: 9 });
}

/** RunLengthDecode data repeating a space 128 times per two bytes. */
export function runLengthSpaces(inflatedBytes: number): Uint8Array {
  const pairs = Math.ceil(inflatedBytes / 128);
  const out = new Uint8Array(pairs * 2 + 1);
  for (let i = 0; i < pairs; i += 1) {
    out[i * 2] = 129; // repeat the next byte 257 - 129 = 128 times
    out[i * 2 + 1] = 0x20;
  }
  out[pairs * 2] = 128; // EOD
  return out;
}

/** zlib data inside zlib data (a two-stage Flate chain). */
export function doubleDeflated(inner: Buffer): Buffer {
  return deflateSync(inner, { level: 9 });
}
