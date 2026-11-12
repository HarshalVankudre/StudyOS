/**
 * A multi-page PDF with a text layer, built in code (one entry per page, each
 * an array of lines; an empty array is a page without text, like a picture
 * slide).
 */
function escapePdfText(text: string): string {
  return text.replace(/[\\()]/g, (char) => `\\${char}`);
}

export function multiPagePdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const pageCount = pages.length;
  // 1: catalog, 2: pages, 3: font, then per page: page object + content stream.
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((lines, i) => {
    const contentRef = 5 + i * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentRef} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    const ops = lines
      .map((line, index) => `BT /F1 12 Tf 72 ${720 - index * 18} Td (${escapePdfText(line)}) Tj ET`)
      .join("\n");
    objects.push(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
  });

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
