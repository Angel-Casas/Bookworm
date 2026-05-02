import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const buf = zipSync({
  mimetype: strToU8('application/epub+zip'),
  // Intentionally no META-INF/container.xml
});

const out = resolve(process.cwd(), 'test-fixtures/malformed-missing-opf.epub');
writeFileSync(out, buf);
console.log(`Wrote ${out}`);
