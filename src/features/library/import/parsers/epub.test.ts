import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseEpubMetadata } from './epub';

function buildEpub(opts: {
  containerXml?: string;
  opf?: string;
  files?: Record<string, string | Uint8Array>;
}): ArrayBuffer {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      opts.containerXml ??
        `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>`,
    ),
    'OEBPS/content.opf': strToU8(
      opts.opf ??
        `<?xml version="1.0"?>
        <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>Quiet Things</dc:title>
            <dc:creator>L. Onuma</dc:creator>
            <meta name="cover" content="cover-img"/>
          </metadata>
          <manifest>
            <item id="cover-img" href="cover.png" media-type="image/png"/>
          </manifest>
        </package>`,
    ),
    'OEBPS/cover.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    ...Object.fromEntries(
      Object.entries(opts.files ?? {}).map(([k, v]) => [
        k,
        typeof v === 'string' ? strToU8(v) : v,
      ]),
    ),
  };
  const zipped = zipSync(files);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}

describe('parseEpubMetadata', () => {
  it('extracts title, author and cover', async () => {
    const buf = buildEpub({});
    const meta = await parseEpubMetadata(buf, 'quiet-things.epub');
    expect(meta.kind).toBe('ok');
    if (meta.kind === 'ok') {
      expect(meta.metadata.title).toBe('Quiet Things');
      expect(meta.metadata.author).toBe('L. Onuma');
      expect(meta.metadata.cover?.mimeType).toBe('image/png');
    }
  });

  it('falls back to filename when title is missing', async () => {
    const buf = buildEpub({
      opf: `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata/></package>`,
    });
    const meta = await parseEpubMetadata(buf, 'untitled-draft.epub');
    expect(meta.kind).toBe('ok');
    if (meta.kind === 'ok') expect(meta.metadata.title).toBe('untitled-draft');
  });

  it('errors when META-INF/container.xml is missing', async () => {
    // Build a zip without container.xml: pass a sentinel and then strip it
    const filesNoContainer = {
      mimetype: strToU8('application/epub+zip'),
      'OEBPS/content.opf': strToU8('<?xml version="1.0"?><package/>'),
    };
    const zipped = zipSync(filesNoContainer);
    const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
    const meta = await parseEpubMetadata(buf, 'broken.epub');
    expect(meta.kind).toBe('error');
  });
});
