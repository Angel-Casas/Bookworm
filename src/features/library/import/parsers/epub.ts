import { unzipSync, strFromU8 } from 'fflate';
import type { ParsedMetadata, ParseResponse } from '@/domain';

const CONTAINER_PATH = 'META-INF/container.xml';

const COVER_MIME = (href: string): string => {
  const lower = href.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
};

function findOpfPath(containerXml: string): string | null {
  const match = /<rootfile[^>]*full-path="([^"]+)"/.exec(containerXml);
  return match?.[1] ?? null;
}

function pluckTagText(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<(?:[a-zA-Z]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z]+:)?${tag}>`);
  const m = re.exec(xml);
  return m?.[1]?.trim();
}

function pluckCoverHref(opfXml: string): string | undefined {
  // EPUB 3: <item properties="cover-image" href="...">
  const ep3 = /<item\s[^>]*properties="[^"]*cover-image[^"]*"[^>]*href="([^"]+)"/.exec(opfXml);
  if (ep3?.[1]) return ep3[1];
  // EPUB 2: <meta name="cover" content="<id>"/>; resolve via manifest
  const idMatch = /<meta\s+name="cover"\s+content="([^"]+)"/.exec(opfXml);
  if (idMatch?.[1]) {
    const idRe = new RegExp(`<item[^>]*id="${idMatch[1]}"[^>]*href="([^"]+)"`);
    const m = idRe.exec(opfXml);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function joinPath(base: string, rel: string): string {
  const segments = base.split('/').slice(0, -1).concat(rel.split('/'));
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export function parseEpubMetadata(
  bytes: ArrayBuffer,
  fileName: string,
): Promise<ParseResponse> {
  let entries: ReturnType<typeof unzipSync>;
  try {
    entries = unzipSync(new Uint8Array(bytes));
  } catch {
    return Promise.resolve({ kind: 'error', reason: 'This EPUB couldn’t be unzipped.' });
  }

  const containerBytes = entries[CONTAINER_PATH];
  if (!containerBytes) {
    return Promise.resolve({
      kind: 'error',
      reason: 'This EPUB is missing its core file (META-INF/container.xml).',
    });
  }
  const opfPath = findOpfPath(strFromU8(containerBytes));
  if (!opfPath) {
    return Promise.resolve({ kind: 'error', reason: 'This EPUB has no OPF root file.' });
  }
  const opfBytes = entries[opfPath];
  if (!opfBytes) {
    return Promise.resolve({
      kind: 'error',
      reason: `This EPUB references ${opfPath} but it’s not in the file.`,
    });
  }
  const opfXml = strFromU8(opfBytes);

  const titleFromOpf = pluckTagText(opfXml, 'title');
  const authorFromOpf = pluckTagText(opfXml, 'creator');

  const coverHref = pluckCoverHref(opfXml);
  let cover: ParsedMetadata['cover'];
  if (coverHref) {
    const coverPath = joinPath(opfPath, coverHref);
    const coverBytes = entries[coverPath];
    if (coverBytes) {
      const ab = new ArrayBuffer(coverBytes.byteLength);
      new Uint8Array(ab).set(coverBytes);
      cover = {
        bytes: ab,
        mimeType: COVER_MIME(coverHref),
      };
    }
  }

  const fallbackTitle = fileName.replace(/\.[^.]+$/, '') || fileName;

  const metadata: ParsedMetadata = {
    format: 'epub',
    title: titleFromOpf ?? fallbackTitle,
    ...(authorFromOpf !== undefined && { author: authorFromOpf }),
    ...(cover && { cover }),
  };

  return Promise.resolve({
    kind: 'ok',
    metadata,
  });
}
