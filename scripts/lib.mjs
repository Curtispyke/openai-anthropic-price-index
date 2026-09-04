import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

export const PACKAGE_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const CREDIT_ROLES = new Set([
  'Conceptualization', 'Data curation', 'Formal analysis', 'Funding acquisition',
  'Investigation', 'Methodology', 'Project administration', 'Resources', 'Software',
  'Supervision', 'Validation', 'Visualization', 'Writing – original draft',
  'Writing – review & editing'
]);

export async function ensureDir(target) { await mkdir(target, { recursive: true }); }
export async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
export async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
export async function writeText(file, value) {
  await ensureDir(path.dirname(file));
  await writeFile(file, String(value).endsWith('\n') ? String(value) : `${value}\n`, 'utf8');
}
export async function loadManifest(productDir) {
  const file = path.join(productDir, 'research-manifest.yaml');
  const raw = await readFile(file, 'utf8');
  try { return JSON.parse(raw); }
  catch (error) { throw new Error(`${file} must use JSON syntax (valid YAML 1.2): ${error.message}`); }
}
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export async function fileDescriptor(root, relativePath) {
  const absolute = path.join(root, relativePath);
  const bytes = await readFile(absolute);
  const details = await stat(absolute);
  return { path: relativePath.replaceAll(path.sep, '/'), bytes: details.size, sha256: sha256(bytes) };
}
export function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function rowsToCsv(headers, rows) {
  return `${headers.join(',')}\n${rows.map(row => headers.map(header => csvEscape(row[header])).join(',')).join('\n')}\n`;
}
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const [headers = [], ...body] = rows.filter(candidate => candidate.some(value => value !== ''));
  return body.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function crcTable() {
  return Array.from({ length: 256 }, (_, value) => {
    let result = value;
    for (let bit = 0; bit < 8; bit += 1) result = result & 1 ? 0xedb88320 ^ (result >>> 8) : result >>> 1;
    return result >>> 0;
  });
}
const CRC_TABLE = crcTable();
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}
function fillRect(pixels, width, height, rectangle, color) {
  const x0 = Math.max(0, Math.floor(rectangle.x));
  const x1 = Math.min(width, Math.ceil(rectangle.x + rectangle.width));
  const y0 = Math.max(0, Math.floor(rectangle.y));
  const y1 = Math.min(height, Math.ceil(rectangle.y + rectangle.height));
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
    const offset = (y * width + x) * 4;
    pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = 255;
  }
}
const FONT = Object.freeze({
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  '?': ['01110','10001','00001','00010','00100','00000','00100'],
  '.': ['00000','00000','00000','00000','00000','00110','00110'],
  ':': ['00000','00110','00110','00000','00110','00110','00000'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '/': ['00001','00010','00100','01000','10000','00000','00000'],
  '%': ['11001','11010','00100','01000','10110','00110','00000'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'], '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'], '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'], '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'], '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'], '9': ['01110','10001','10001','01111','00001','00001','01110'],
  A: ['01110','10001','10001','11111','10001','10001','10001'], B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01110','10001','10000','10000','10000','10001','01110'], D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'], F: ['11111','10000','10000','11110','10000','10000','10000'],
  G: ['01110','10001','10000','10111','10001','10001','01110'], H: ['10001','10001','10001','11111','10001','10001','10001'],
  I: ['01110','00100','00100','00100','00100','00100','01110'], J: ['00111','00010','00010','00010','10010','10010','01100'],
  K: ['10001','10010','10100','11000','10100','10010','10001'], L: ['10000','10000','10000','10000','10000','10000','11111'],
  M: ['10001','11011','10101','10101','10001','10001','10001'], N: ['10001','11001','10101','10011','10001','10001','10001'],
  O: ['01110','10001','10001','10001','10001','10001','01110'], P: ['11110','10001','10001','11110','10000','10000','10000'],
  Q: ['01110','10001','10001','10001','10101','10010','01101'], R: ['11110','10001','10001','11110','10100','10010','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'], T: ['11111','00100','00100','00100','00100','00100','00100'],
  U: ['10001','10001','10001','10001','10001','10001','01110'], V: ['10001','10001','10001','10001','10001','01010','00100'],
  W: ['10001','10001','10001','10101','10101','10101','01010'], X: ['10001','10001','01010','00100','01010','10001','10001'],
  Y: ['10001','10001','01010','00100','00100','00100','00100'], Z: ['11111','00001','00010','00100','01000','10000','11111']
});
function drawText(pixels, width, height, text, x, y, scale = 2, color = [15, 23, 42], maxWidth = width - x) {
  const glyphWidth = 6 * scale;
  const visible = String(text).toUpperCase().slice(0, Math.max(0, Math.floor(maxWidth / glyphWidth)));
  for (let charIndex = 0; charIndex < visible.length; charIndex += 1) {
    const glyph = FONT[visible[charIndex]] ?? FONT['?'];
    glyph.forEach((line, row) => [...line].forEach((bit, column) => {
      if (bit === '1') fillRect(pixels, width, height, { x: x + charIndex * glyphWidth + column * scale, y: y + row * scale, width: scale, height: scale }, color);
    }));
  }
}
export function renderBarPng({ title, version, rows, width = 1600, height = 900 }) {
  const pixels = Buffer.alloc(width * height * 4);
  fillRect(pixels, width, height, { x: 0, y: 0, width, height }, [248, 250, 252]);
  drawText(pixels, width, height, title, 96, 70, 5, [15, 23, 42], width - 192);
  drawText(pixels, width, height, `KINGY RESEARCH / ${version}`, 96, 135, 3, [71, 85, 105], width - 192);
  const max = Math.max(...rows.map(row => Number(row.value)), 1);
  const startY = 220, rowHeight = Math.min(110, Math.floor(540 / Math.max(rows.length, 1))), labelWidth = 360;
  rows.forEach((row, index) => {
    const y = startY + index * rowHeight;
    drawText(pixels, width, height, row.label, 96, y + 8, 3, [15, 23, 42], labelWidth - 30);
    const barWidth = Math.max(2, Math.round((Number(row.value) / max) * (width - labelWidth - 220)));
    fillRect(pixels, width, height, { x: labelWidth, y, width: barWidth, height: Math.max(20, rowHeight - 26) }, index % 2 ? [13, 148, 136] : [37, 99, 235]);
    drawText(pixels, width, height, String(row.value), labelWidth + barWidth + 20, y + 8, 3, [15, 23, 42], 180);
  });
  drawText(pixels, width, height, 'SEE CSV FOR EXACT PLOTTED VALUES AND SOURCES', 96, height - 72, 2, [71, 85, 105], width - 192);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', ihdr), pngChunk('sRGB', Buffer.from([0])),
    pngChunk('tEXt', Buffer.from(`Title\0${title}`, 'latin1')), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))
  ]);
}
export function renderBarSvg({ title, description, version, rows, width = 800, height = 450 }) {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' })[char]);
  const max = Math.max(...rows.map(row => Number(row.value)), 1);
  const startY = 120, rowHeight = Math.min(58, Math.floor(250 / Math.max(rows.length, 1))), x = 210;
  const bars = rows.map((row, index) => {
    const y = startY + index * rowHeight, barWidth = Math.max(1, Math.round((Number(row.value) / max) * 470));
    return `<text x="32" y="${y + 21}" font-size="15" fill="#0f172a">${escape(row.label)}</text><rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(18, rowHeight - 16)}" rx="4" fill="${index % 2 ? '#0d9488' : '#2563eb'}"/><text x="${x + barWidth + 8}" y="${y + 21}" font-size="14" fill="#0f172a">${escape(row.value)}</text>`;
  }).join('');
  const table = rows.map(row => `<tr><th>${escape(row.label)}</th><td>${escape(row.value)}</td><td>${escape(row.unit ?? '')}</td></tr>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="chart-title chart-desc" viewBox="0 0 ${width} ${height}"><title id="chart-title">${escape(title)}</title><desc id="chart-desc">${escape(description)}</desc><rect width="100%" height="100%" fill="#f8fafc"/><text x="32" y="48" font-size="26" font-weight="700" fill="#0f172a">${escape(title)}</text><text x="32" y="76" font-size="13" fill="#475569">Kingy Research / ${escape(version)}</text>${bars}<text x="32" y="425" font-size="12" fill="#475569">Exact values, definitions, and sources are included in the companion CSV.</text><foreignObject x="0" y="0" width="1" height="1"><table xmlns="http://www.w3.org/1999/xhtml"><caption>${escape(title)}</caption><thead><tr><th>Label</th><th>Value</th><th>Unit</th></tr></thead><tbody>${table}</tbody></table></foreignObject></svg>\n`;
}
export async function writeChartBundle(productDir, chart, rows) {
  const csv = rowsToCsv(['label', 'value', 'unit', 'source_url', 'retrieved_at'], rows);
  await writeText(path.join(productDir, chart.csv), csv);
  await writeText(path.join(productDir, chart.svg), renderBarSvg({ title: chart.title, description: chart.alt, version: chart.version, rows }));
  await ensureDir(path.dirname(path.join(productDir, chart.png)));
  await writeFile(path.join(productDir, chart.png), renderBarPng({ title: chart.title, version: chart.version, rows }));
  await writeText(path.join(productDir, `charts/${chart.slug}.alt.txt`), chart.alt);
}
export function isDataProduct(manifest) { return ['dataset', 'benchmark', 'living-dataset'].includes(manifest.product_type); }
export function yamlString(value) { return JSON.stringify(String(value)); }
export function doiUrl(doi) { return doi ? `https://doi.org/${doi}` : null; }
