/**
 * Tiny, hand-built document fixtures for the extraction tests: a real PDF
 * with a text layer, a "scanned" PDF with only graphics, a flate-bomb PDF,
 * and .docx archives. Built in code so the tests show exactly what is inside.
 */
import { zipSync, zlibSync, strToU8 } from "fflate";

/** Assemble a PDF from object bodies, computing a correct xref table. */
function buildPdf(objects: string[]): Uint8Array {
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

function escapePdfText(text: string): string {
  return text.replace(/[\\()]/g, (char) => `\\${char}`);
}

/** One-page PDF whose content stream draws the given lines of text. */
export function textPdf(lines: string[]): Uint8Array {
  const ops = lines
    .map((line, index) => `BT /F1 12 Tf 72 ${720 - index * 18} Td (${escapePdfText(line)}) Tj ET`)
    .join("\n");
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
}

/** One-page PDF with only a filled rectangle: what a scan looks like to a text extractor. */
export function graphicsOnlyPdf(): Uint8Array {
  const ops = "0.5 g 72 72 468 648 re f";
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
    `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`,
  ]);
}

/** PDF with a FlateDecode stream that inflates to `inflatedBytes` of zeros. */
export function flateBombPdf(inflatedBytes: number): Uint8Array {
  const payload = zlibSync(new Uint8Array(inflatedBytes), { level: 9 });
  const header = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      `2 0 obj\n<< /Length ${payload.length} /Filter /FlateDecode >>\nstream\n`,
    "latin1",
  );
  const footer = Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
  return new Uint8Array(Buffer.concat([header, Buffer.from(payload), footer]));
}

/** Minimal valid .docx with one paragraph per entry; arrays become a table row. */
export function docx(paragraphs: Array<string | string[]>): Uint8Array {
  const esc = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = paragraphs
    .map((paragraph) =>
      Array.isArray(paragraph)
        ? `<w:tbl><w:tr>${paragraph
            .map((cell) => `<w:tc><w:p><w:r><w:t>${esc(cell)}</w:t></w:r></w:p></w:tc>`)
            .join("")}</w:tr></w:tbl>`
        : `<w:p><w:r><w:t xml:space="preserve">${esc(paragraph)}</w:t></w:r></w:p>`,
    )
    .join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "word/document.xml": strToU8(documentXml),
  });
}

/** A .docx whose document.xml inflates to `inflatedBytes` (a zip bomb). */
export function docxBomb(inflatedBytes: number): Uint8Array {
  const filler = new Uint8Array(inflatedBytes).fill(0x20);
  return zipSync({ "word/document.xml": [filler, { level: 9 }] });
}

