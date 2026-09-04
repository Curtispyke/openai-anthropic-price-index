import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadManifest, PACKAGE_ROOT, parseCsv, writeChartBundle } from './lib.mjs';

const targets = process.argv.slice(2);
const productDirs = targets.length
  ? targets.map(target => path.resolve(target))
  : (await readdir(path.join(PACKAGE_ROOT, 'pilots'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(PACKAGE_ROOT, 'pilots', entry.name));

for (const productDir of productDirs) {
  const manifest = await loadManifest(productDir);
  for (const chart of manifest.charts) {
    const rows = parseCsv(await readFile(path.join(productDir, chart.csv), 'utf8'));
    await writeChartBundle(productDir, { ...chart, version: manifest.version }, rows);
    process.stdout.write(`rebuilt ${manifest.slug}/${chart.slug}\n`);
  }
}
