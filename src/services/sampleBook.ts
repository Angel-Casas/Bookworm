/**
 * The book the tour is given to point at.
 *
 * A tour of an empty shelf explains furniture and not a house: no card, no
 * cover, no progress rail, no "Continue reading", and nothing to open when the
 * time comes to show the reader itself. So the tour brings a book with it —
 * three short chapters, written for this and belonging to Bookworm, built into
 * a real EPUB here in the browser and imported down the same path as anything
 * a reader drags in. It is a book like any other once it lands: it can be read,
 * marked, asked about, and removed.
 *
 * The text comes from the message catalogue, so the sample book is in the
 * reader's own language. A first book that arrives in a language you do not
 * read is a poor welcome.
 */
import { strToU8, zipSync, type Zippable } from 'fflate'
import { importBookFile } from '@/services/bookImport'
import type { ImportedBook } from '@/lib/types'

/** The chapters, as catalogue keys: a title and the paragraphs under it. */
const CHAPTERS: readonly { title: string; paragraphs: readonly string[] }[] = [
  {
    title: 'sample.ch1.title',
    paragraphs: ['sample.ch1.p1', 'sample.ch1.p2', 'sample.ch1.p3'],
  },
  {
    title: 'sample.ch2.title',
    paragraphs: ['sample.ch2.p1', 'sample.ch2.p2', 'sample.ch2.p3'],
  },
  {
    title: 'sample.ch3.title',
    paragraphs: ['sample.ch3.p1', 'sample.ch3.p2'],
  },
] as const

/** Every key the sample book needs, so the caller can hand them all in at
 *  once and this file stays free of any language of its own. */
export const SAMPLE_KEYS: readonly string[] = [
  'sample.title',
  'sample.author',
  ...CHAPTERS.flatMap((chapter) => [chapter.title, ...chapter.paragraphs]),
]

/** XML is not HTML: an unescaped ampersand in a title is a broken EPUB. */
function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function page(title: string, body: string, language: string, dir: 'ltr' | 'rtl'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${xml(language)}" dir="${dir}">
<head><title>${xml(title)}</title></head>
<body><h1>${xml(title)}</h1>
${body}
</body></html>
`
}

export interface SampleBookText {
  /** Catalogue key to text, for every key in SAMPLE_KEYS. */
  words: Record<string, string>
  /** The reader's language, for the EPUB's own metadata and page direction. */
  language: string
  dir: 'ltr' | 'rtl'
}

/**
 * Build the EPUB. Deterministic apart from the identifier, which is seeded
 * from the language so re-running the tour in the same language does not make
 * a book the reader's shelf treats as different.
 */
export function buildSampleEpub(text: SampleBookText): Blob {
  const say = (key: string): string => text.words[key] ?? key
  const title = say('sample.title')
  const author = say('sample.author')

  const files: Zippable = {}
  const spine: string[] = []
  const manifest: string[] = []
  const nav: string[] = []

  CHAPTERS.forEach((chapter, index) => {
    const id = `ch${index + 1}`
    const href = `${id}.xhtml`
    const heading = say(chapter.title)
    const body = chapter.paragraphs.map((key) => `<p>${xml(say(key))}</p>`).join('\n')
    files[`OEBPS/${href}`] = strToU8(page(heading, body, text.language, text.dir))
    manifest.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`)
    spine.push(`<itemref idref="${id}"/>`)
    nav.push(`<li><a href="${href}">${xml(heading)}</a></li>`)
  })

  files['OEBPS/nav.xhtml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${xml(title)}</title></head>
<body><nav epub:type="toc"><ol>${nav.join('')}</ol></nav></body></html>
`,
  )
  manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>')

  files['OEBPS/content.opf'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:bookworm:sample:${xml(text.language)}</dc:identifier>
    <dc:title>${xml(title)}</dc:title>
    <dc:creator>${xml(author)}</dc:creator>
    <dc:language>${xml(text.language)}</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>${manifest.join('')}</manifest>
  <spine>${spine.join('')}</spine>
</package>
`,
  )

  files['META-INF/container.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`,
  )
  // The mimetype entry must be first and stored uncompressed — the one part of
  // an EPUB that is a zip-level requirement rather than an XML one.
  const zipped = zipSync(
    { mimetype: [strToU8('application/epub+zip'), { level: 0 }], ...files },
    { level: 6 },
  )
  return new Blob([zipped as unknown as BlobPart], { type: 'application/epub+zip' })
}

/** A file name a reader would recognise on their own disk. */
export function sampleFileName(title: string): string {
  const stem = title
    .normalize('NFC')
    .replace(/[\p{P}\p{S}\p{C}]/gu, ' ')
    .replace(/\s+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase()
    .slice(0, 50)
  return `${stem.length > 0 ? stem : 'bookworm-sample'}.epub`
}

/** Build it and put it through the ordinary import, so the sample book is a
 *  book — same metadata, same cover hunt, same everything. */
export async function importSampleBook(text: SampleBookText): Promise<ImportedBook> {
  const blob = buildSampleEpub(text)
  const name = sampleFileName(text.words['sample.title'] ?? 'sample')
  return importBookFile(new File([blob], name, { type: 'application/epub+zip' }))
}
