// Produces a minimal valid 1-page PDF with /Info Title and Author.
// Run with: pnpm tsx scripts/fixtures/build-text-pdf.ts
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function pdfString(s: string): string {
  return `(${s.replace(/[\\()]/g, (ch) => `\\${ch}`)})`;
}

function buildPdf(): Uint8Array {
  const objects: string[] = [];
  const offsets: number[] = [];

  const push = (body: string): number => {
    const id = objects.length + 1;
    objects.push(`${String(id)} 0 obj\n${body}\nendobj\n`);
    return id;
  };

  const contentStream = 'BT /F1 24 Tf 72 720 Td (Hello, Bookworm.) Tj ET';
  const fId = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const cId = push(
    `<< /Length ${String(contentStream.length)} >>\nstream\n${contentStream}\nendstream`,
  );
  // Reserve next ids: page=3, pages=4, catalog=5
  const pId = push(
    `<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Contents ${String(cId)} 0 R /Resources << /Font << /F1 ${String(fId)} 0 R >> >> >>`,
  );
  const psId = push(`<< /Type /Pages /Kids [${String(pId)} 0 R] /Count 1 >>`);
  const catId = push(`<< /Type /Catalog /Pages ${String(psId)} 0 R >>`);
  const infoId = push(
    `<< /Title ${pdfString('Text-Friendly PDF')} /Author ${pdfString('Bookworm Test Suite')} >>`,
  );

  const header = '%PDF-1.4\n%âãÏÓ\n';
  let body = header;
  for (let i = 0; i < objects.length; i += 1) {
    offsets[i] = body.length;
    body += objects[i] ?? '';
  }
  const xrefOffset = body.length;
  let xref = `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer << /Size ${String(objects.length + 1)} /Root ${String(catId)} 0 R /Info ${String(infoId)} 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return new TextEncoder().encode(body + xref + trailer);
}

const out = resolve(process.cwd(), 'test-fixtures/text-friendly.pdf');
writeFileSync(out, buildPdf());
console.log(`Wrote ${out}`);
