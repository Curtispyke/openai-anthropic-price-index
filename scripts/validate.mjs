import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { CREDIT_ROLES, isDataProduct, loadManifest, sha256, writeJson } from './lib.mjs';
import { validateManifestSchema } from './schema-validator.mjs';

const ORCID = /^https:\/\/orcid\.org\/[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$/;
const VERSION = /^v[0-9]{1,4}\.[0-9]{1,2}\.[0-9]+$/;
const SHA = /^[0-9a-f]{64}$/;
const PNG_SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);
const REQUIRED_DISCLOSURE = ['conclusion','funder','commissioned_by','prepublication_review','editorial_control','consideration','conflicts','interested_party_data','ai_use','independent_review','limitations','corrections','review_status'];

function add(list, code, message, file = null) { list.push({ code, message, file }); }
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }
async function exists(file) { try { await stat(file); return true; } catch { return false; } }

async function verifyChecksums(productDir, failures) {
  const checksumFile = path.join(productDir, 'provenance/checksums.sha256');
  if (!await exists(checksumFile)) { add(failures, 'checksums.missing', 'Missing provenance/checksums.sha256', 'provenance/checksums.sha256'); return; }
  const lines = (await readFile(checksumFile, 'utf8')).trim().split('\n').filter(Boolean);
  const seen = new Set();
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  ([^\r\n]+)$/);
    if (!match) { add(failures, 'checksums.syntax', `Invalid checksum line: ${line}`, 'provenance/checksums.sha256'); continue; }
    const [, expected, relative] = match;
    if (relative.startsWith('/') || relative.split('/').includes('..')) { add(failures, 'checksums.path', `Unsafe checksum path: ${relative}`); continue; }
    if (seen.has(relative)) add(failures, 'checksums.duplicate', `Duplicate checksum path: ${relative}`);
    seen.add(relative);
    const absolute = path.join(productDir, relative);
    if (!await exists(absolute)) { add(failures, 'checksums.file_missing', `Checksummed file missing: ${relative}`, relative); continue; }
    const actual = sha256(await readFile(absolute));
    if (actual !== expected) add(failures, 'checksums.mismatch', `Checksum mismatch: ${relative}`, relative);
  }
}

async function verifyGeneratedMetadata(productDir, manifest, failures) {
  const cffPath = path.join(productDir, 'CITATION.cff');
  if (!await exists(cffPath)) add(failures, 'cff.missing', 'Missing CITATION.cff', 'CITATION.cff');
  else {
    const cff = await readFile(cffPath, 'utf8');
    for (const needle of ['cff-version: 1.2.0', `title: ${JSON.stringify(manifest.title)}`, `version: ${JSON.stringify(manifest.version.replace(/^v/, ''))}`]) {
      if (!cff.includes(needle)) add(failures, 'cff.drift', `CITATION.cff missing or inconsistent: ${needle}`, 'CITATION.cff');
    }
    if (!cff.includes('type: dataset') && isDataProduct(manifest)) add(failures, 'cff.type', 'Dataset package must use type: dataset', 'CITATION.cff');
    for (const creator of manifest.creators) if (!cff.includes(creator.family_name) || !cff.includes(creator.given_name)) add(failures, 'cff.creator', `Creator missing from CFF: ${creator.name}`, 'CITATION.cff');
  }
  const jsonLdPath = path.join(productDir, 'metadata/research-product.jsonld');
  if (!await exists(jsonLdPath)) add(failures, 'jsonld.missing', 'Missing JSON-LD', 'metadata/research-product.jsonld');
  else {
    const doc = JSON.parse(await readFile(jsonLdPath, 'utf8'));
    if (doc.name !== manifest.title || doc.description !== manifest.description || doc.version !== manifest.version) add(failures, 'jsonld.drift', 'JSON-LD title, description, or version disagrees with manifest', 'metadata/research-product.jsonld');
    if (isDataProduct(manifest) && doc['@type'] !== 'Dataset') add(failures, 'jsonld.type', 'Data product JSON-LD must be Dataset', 'metadata/research-product.jsonld');
    if (!Array.isArray(doc.distribution) || doc.distribution.length !== manifest.distributions.length) add(failures, 'jsonld.distributions', 'JSON-LD distribution count disagrees with manifest', 'metadata/research-product.jsonld');
    for (const distribution of doc.distribution ?? []) if (!distribution.contentUrl || !distribution.encodingFormat) add(failures, 'jsonld.download', 'Every DataDownload needs contentUrl and encodingFormat', 'metadata/research-product.jsonld');
  }
  const zenodoPath = path.join(productDir, 'metadata/zenodo.json');
  if (!await exists(zenodoPath)) add(failures, 'zenodo.missing', 'Missing Zenodo metadata', 'metadata/zenodo.json');
  else {
    const doc = JSON.parse(await readFile(zenodoPath, 'utf8'));
    if (doc.title !== manifest.title || doc.version !== manifest.version.replace(/^v/, '') || doc.license !== manifest.licenses.data) add(failures, 'zenodo.drift', 'Zenodo metadata disagrees with manifest', 'metadata/zenodo.json');
    if (!Array.isArray(doc.creators) || doc.creators.length !== manifest.creators.length) add(failures, 'zenodo.creators', 'Zenodo creators disagree with manifest', 'metadata/zenodo.json');
  }
  if (isDataProduct(manifest)) {
    for (const relative of ['metadata/croissant.json', 'README.huggingface.md']) if (!await exists(path.join(productDir, relative))) add(failures, 'dataset.metadata_missing', `Missing dataset metadata: ${relative}`, relative);
    if (await exists(path.join(productDir, 'metadata/croissant.json'))) {
      const doc = JSON.parse(await readFile(path.join(productDir, 'metadata/croissant.json'), 'utf8'));
      if (doc.name !== manifest.title || doc.version !== manifest.version || doc.conformsTo !== 'http://mlcommons.org/croissant/1.1') add(failures, 'croissant.drift', 'Croissant metadata disagrees with manifest', 'metadata/croissant.json');
    }
    if (await exists(path.join(productDir, 'README.huggingface.md'))) {
      const card = await readFile(path.join(productDir, 'README.huggingface.md'), 'utf8');
      if (!card.startsWith('---\n') || !card.includes(manifest.title) || !card.includes('## Limitations and bias')) add(failures, 'hf.card', 'Hugging Face card is incomplete or inconsistent', 'README.huggingface.md');
    }
  }
}

async function verifyCharts(productDir, manifest, failures) {
  if (manifest.charts.length && !await exists(path.join(productDir, 'charts/charts-manifest.csv'))) add(failures, 'chart.manifest_missing', 'Missing charts/charts-manifest.csv', 'charts/charts-manifest.csv');
  if (manifest.charts.length && await exists(path.join(productDir, 'charts/charts-manifest.csv'))) {
    const chartManifest = await readFile(path.join(productDir, 'charts/charts-manifest.csv'), 'utf8');
    for (const chart of manifest.charts) if (!chartManifest.includes(chart.slug) || !chartManifest.includes(manifest.version)) add(failures, 'chart.manifest_drift', `Chart manifest is inconsistent for ${chart.slug}`, 'charts/charts-manifest.csv');
  }
  for (const chart of manifest.charts) {
    for (const key of ['csv','svg','png']) if (!await exists(path.join(productDir, chart[key]))) add(failures, 'chart.missing', `Missing ${key.toUpperCase()} for ${chart.slug}`, chart[key]);
    const altPath = path.join(productDir, `charts/${chart.slug}.alt.txt`);
    if (!await exists(altPath)) add(failures, 'chart.alt_missing', `Missing alt text file for ${chart.slug}`);
    else if ((await readFile(altPath, 'utf8')).trim() !== chart.alt.trim()) add(failures, 'chart.alt_drift', `Alt text disagrees with manifest for ${chart.slug}`, `charts/${chart.slug}.alt.txt`);
    if (await exists(path.join(productDir, chart.svg))) {
      const svg = await readFile(path.join(productDir, chart.svg), 'utf8');
      if (!svg.includes('<title') || !svg.includes('<desc') || !svg.includes('role="img"')) add(failures, 'chart.svg_accessibility', `SVG is missing title, description, or role for ${chart.slug}`, chart.svg);
    }
    if (await exists(path.join(productDir, chart.png))) {
      const png = await readFile(path.join(productDir, chart.png));
      if (!png.subarray(0, 8).equals(PNG_SIGNATURE) || png.readUInt32BE(16) !== 1600 || png.readUInt32BE(20) !== 900) add(failures, 'chart.png_profile', `PNG must be 1600x900 RGBA for ${chart.slug}`, chart.png);
    }
    if (await exists(path.join(productDir, chart.csv))) {
      const first = (await readFile(path.join(productDir, chart.csv), 'utf8')).split('\n')[0];
      if (first !== 'label,value,unit,source_url,retrieved_at') add(failures, 'chart.csv_schema', `Chart CSV schema mismatch for ${chart.slug}`, chart.csv);
    }
  }
}

async function verifyDistributions(productDir, manifest, failures) {
  const paths = new Set();
  for (const item of manifest.distributions) {
    if (paths.has(item.path)) add(failures, 'distribution.duplicate', `Duplicate distribution path: ${item.path}`);
    paths.add(item.path);
    if (item.path.startsWith('/') || item.path.split('/').includes('..')) { add(failures, 'distribution.path', `Unsafe distribution path: ${item.path}`); continue; }
    const absolute = path.join(productDir, item.path);
    if (!await exists(absolute)) { add(failures, 'distribution.missing', `Distribution missing: ${item.path}`, item.path); continue; }
    const bytes = await readFile(absolute);
    if (bytes.length !== item.size_bytes || sha256(bytes) !== item.sha256) add(failures, 'distribution.integrity', `Distribution bytes disagree with manifest: ${item.path}`, item.path);
  }
}

function verifyManifest(manifest, failures, holds) {
  const required = ['schema_version','id','slug','title','description','product_type','classification','version','version_scheme','release_date','status','publication_authorized','canonical_url','repository_url','creators','publisher','contact','licenses','methodology','provenance','disclosure','privacy','keywords','platforms','distributions','charts','release'];
  for (const key of required) if (manifest[key] == null) add(failures, 'manifest.required', `Missing required field: ${key}`, 'research-manifest.yaml');
  if (manifest.schema_version !== 'kingy-research-manifest-v1') add(failures, 'manifest.schema_version', 'Unsupported schema_version');
  if (!VERSION.test(manifest.version ?? '')) add(failures, 'manifest.version', 'Invalid version format');
  if (manifest.version_scheme === 'calver' && !/^v20\d{2}\.(?:0?[1-9]|1[0-2])\.\d+$/.test(manifest.version ?? '')) add(failures, 'manifest.calver', 'CalVer must use vYYYY.MM.PATCH with a valid month');
  if (manifest.version_scheme === 'semver' && !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(manifest.version ?? '')) add(failures, 'manifest.semver', 'SemVer must use vMAJOR.MINOR.PATCH');
  if ((manifest.description ?? '').length < 50 || manifest.description.length > 5000) add(failures, 'manifest.description', 'Description must be 50–5,000 characters');
  if (!Array.isArray(manifest.creators) || !manifest.creators.length) add(failures, 'manifest.creators', 'At least one named creator is required');
  for (const person of manifest.creators ?? []) {
    if (!nonempty(person.name) || !nonempty(person.given_name) || !nonempty(person.family_name)) add(failures, 'creator.name', 'Creator must have display, given, and family names');
    if (person.orcid && !ORCID.test(person.orcid)) add(failures, 'creator.orcid', `Malformed ORCID: ${person.orcid}`);
    if (!Array.isArray(person.roles) || !person.roles.length) add(failures, 'creator.roles', `Missing CRediT roles for ${person.name}`);
    for (const role of person.roles ?? []) if (!CREDIT_ROLES.has(role)) add(failures, 'creator.role_unknown', `Unknown CRediT role: ${role}`);
    if (person.identity_status !== 'confirmed') add(holds, 'creator.confirmation', `Creator identity/role confirmation pending: ${person.name}`);
  }
  for (const key of REQUIRED_DISCLOSURE) if (!nonempty(String(manifest.disclosure?.[key] ?? ''))) add(failures, 'disclosure.required', `Missing disclosure field: ${key}`);
  if (manifest.disclosure?.review_status !== 'approved') add(holds, 'disclosure.review', 'Accountable disclosure review is pending');
  if (manifest.disclosure?.conclusion === 'Pending accountable review') add(holds, 'disclosure.conclusion', 'Independence conclusion is pending accountable review');
  if (manifest.licenses?.rights_status !== 'approved') add(holds, 'rights.review', `Rights status is ${manifest.licenses?.rights_status ?? 'missing'}`);
  if (manifest.privacy?.review_status !== 'approved') add(holds, 'privacy.review', `Privacy review is ${manifest.privacy?.review_status ?? 'missing'}`);
  if (manifest.privacy?.redistribution_status !== 'approved') add(holds, 'redistribution.review', `Redistribution status is ${manifest.privacy?.redistribution_status ?? 'missing'}`);
  if (manifest.platforms?.zenodo && (!manifest.dois?.concept || !manifest.dois?.version)) add(holds, 'doi.pending', 'Zenodo concept and version DOI are pending');
  for (const [name, value] of Object.entries({ canonical_url: manifest.canonical_url, repository_url: manifest.repository_url, huggingface_url: manifest.huggingface_url, zenodo_url: manifest.zenodo_url })) {
    if (value && /example\.invalid|\/OWNER\/|REPOSITORY/.test(value)) add(holds, 'destination.placeholder', `${name} still contains a placeholder`);
  }
  if (!manifest.publication_authorized) add(holds, 'publication.authorization', 'External publication is not authorized');
  if (!['local-candidate', 'released'].includes(manifest.status)) add(holds, 'status.invalid_release_state', `Status is ${manifest.status}`);
  for (const item of manifest.distributions ?? []) {
    if (!String(item.content_url ?? '').startsWith('https://')) add(failures, 'distribution.url', `Distribution content_url must use HTTPS: ${item.path}`);
    if (!SHA.test(item.sha256 ?? '')) add(failures, 'distribution.sha256', `Invalid SHA-256 for ${item.path}`);
    if (!Number.isInteger(item.size_bytes) || item.size_bytes < 1) add(failures, 'distribution.size', `Invalid size for ${item.path}`);
  }
}

async function scanSecrets(productDir, failures) {
  const release = JSON.parse(await readFile(path.join(productDir, 'release-payload.json'), 'utf8'));
  const patterns = [
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private-key'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'aws-access-key'],
    [/\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/, 'github-token'],
    [/\bsk-[A-Za-z0-9_-]{20,}\b/, 'api-key']
  ];
  for (const item of release.files) {
    if (/\.(?:png|zip|gz|parquet)$/i.test(item.path)) continue;
    const text = await readFile(path.join(productDir, item.path), 'utf8');
    for (const [pattern, code] of patterns) if (pattern.test(text)) add(failures, `secret.${code}`, `Potential secret in ${item.path}`, item.path);
  }
}

export async function validateProduct(productDir) {
  const failures = [], holds = [];
  let manifest;
  try { manifest = await loadManifest(productDir); }
  catch (error) { add(failures, 'manifest.parse', error.message, 'research-manifest.yaml'); }
  if (manifest) {
    for (const message of await validateManifestSchema(manifest)) add(failures, 'manifest.schema', message, 'research-manifest.yaml');
    verifyManifest(manifest, failures, holds);
    await verifyGeneratedMetadata(productDir, manifest, failures);
    await verifyDistributions(productDir, manifest, failures);
    await verifyCharts(productDir, manifest, failures);
  }
  await verifyChecksums(productDir, failures);
  if (await exists(path.join(productDir, 'release-payload.json'))) await scanSecrets(productDir, failures);
  else add(failures, 'payload.missing', 'Missing release-payload.json', 'release-payload.json');
  const outcome = failures.length ? 'FAIL' : holds.length ? 'HOLD' : 'PASS';
  const report = {
    schema_version: 'kingy-research-product-gate-v1', product_id: manifest?.id ?? null,
    version: manifest?.version ?? null, outcome, local_candidate_only: !manifest?.publication_authorized,
    checked_at: new Date().toISOString(), failures, holds,
    checks: {
      manifest: !failures.some(item => item.code.startsWith('manifest.')),
      citation: !failures.some(item => item.code.startsWith('cff.')),
      structured_data: !failures.some(item => item.code.startsWith('jsonld.') || item.code.startsWith('croissant.')),
      platform_metadata: !failures.some(item => item.code.startsWith('zenodo.') || item.code.startsWith('hf.') || item.code.startsWith('dataset.')),
      distributions: !failures.some(item => item.code.startsWith('distribution.')),
      charts: !failures.some(item => item.code.startsWith('chart.')),
      checksums: !failures.some(item => item.code.startsWith('checksums.')),
      secrets: !failures.some(item => item.code.startsWith('secret.'))
    }
  };
  await writeJson(path.join(productDir, 'gate-report.json'), report);
  return report;
}

async function main() {
  const productDir = path.resolve(process.argv[2] ?? '.');
  const report = await validateProduct(productDir);
  process.stdout.write(`${path.basename(productDir)}: ${report.outcome} (${report.failures.length} failures, ${report.holds.length} holds)\n`);
  if (report.outcome === 'FAIL') process.exitCode = 1;
  else if (report.outcome === 'HOLD') process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main().catch(error => { console.error(error); process.exitCode = 1; });
