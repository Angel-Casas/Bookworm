// Produces a minimal valid 5-page PDF, each page with a distinct heading.
// Run with: pnpm tsx scripts/fixtures/build-multipage-pdf.ts
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE_COUNT = 5;

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

  // Single shared font
  const fId = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  // Build per-page content streams first (each becomes an object).
  const contentIds: number[] = [];
  for (let i = 1; i <= PAGE_COUNT; i += 1) {
    const stream = `BT /F1 36 Tf 72 720 Td (Page ${String(i)} of ${String(PAGE_COUNT)}) Tj ET`;
    const cId = push(`<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`);
    contentIds.push(cId);
  }
  // Reserve the parent Pages object id: it's the next id after we push all PAGE_COUNT page objects.
  const parentId = objects.length + 1 + PAGE_COUNT;
  const pageIds: number[] = [];
  for (let i = 0; i < PAGE_COUNT; i += 1) {
    const cId = contentIds[i]!;
    const pId = push(
      `<< /Type /Page /Parent ${String(parentId)} 0 R /MediaBox [0 0 612 792] /Contents ${String(cId)} 0 R /Resources << /Font << /F1 ${String(fId)} 0 R >> >> >>`,
    );
    pageIds.push(pId);
  }
  const psId = push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(PAGE_COUNT)} >>`,
  );
  if (psId !== parentId) {
    throw new Error(
      `Multipage PDF: parentId reservation mismatch (${String(psId)} vs ${String(parentId)})`,
    );
  }
  const catId = push(`<< /Type /Catalog /Pages ${String(psId)} 0 R >>`);
  const infoId = push(
    `<< /Title ${pdfString('Multipage Test PDF')} /Author ${pdfString('Bookworm Test Suite')} >>`,
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

const out = resolve(process.cwd(), 'test-fixtures/multipage.pdf');
writeFileSync(out, buildPdf());
console.log(`Wrote ${out}`);
