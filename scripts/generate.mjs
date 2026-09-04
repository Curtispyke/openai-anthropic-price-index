import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  doiUrl, ensureDir, fileDescriptor, isDataProduct, loadManifest, PACKAGE_ROOT,
  rowsToCsv, writeJson, writeText, yamlString
} from './lib.mjs';

function cff(manifest) {
  const authors = manifest.creators.flatMap(person => [
    `  - family-names: ${yamlString(person.family_name)}`,
    `    given-names: ${yamlString(person.given_name)}`,
    ...(person.orcid ? [`    orcid: ${yamlString(person.orcid)}`] : []),
    `    affiliation: ${yamlString(person.affiliation)}`
  ]).join('\n');
  const identifiers = [
    manifest.dois?.concept && { value: manifest.dois.concept, description: 'Concept DOI for all versions' },
    manifest.dois?.version && { value: manifest.dois.version, description: `Version DOI for ${manifest.version}` }
  ].filter(Boolean);
  return [
    'cff-version: 1.2.0',
    `message: ${yamlString('If you use this research product, cite the exact version below.')}`,
    `type: ${isDataProduct(manifest) || manifest.product_type === 'report' ? 'dataset' : 'software'}`,
    `title: ${yamlString(manifest.title)}`,
    `abstract: ${yamlString(manifest.description)}`,
    'authors:', authors,
    `version: ${yamlString(manifest.version.replace(/^v/, ''))}`,
    `date-released: ${yamlString(manifest.release_date)}`,
    `url: ${yamlString(manifest.canonical_url)}`,
    `repository-code: ${yamlString(manifest.repository_url)}`,
    `license: ${yamlString(manifest.licenses.data)}`,
    ...(identifiers.length ? ['identifiers:', ...identifiers.flatMap(item => [
      '  - type: doi', `    value: ${yamlString(item.value)}`, `    description: ${yamlString(item.description)}`
    ])] : []),
    'keywords:', ...manifest.keywords.map(keyword => `  - ${yamlString(keyword)}`), ''
  ].join('\n');
}

function personJsonLd(person) {
  return {
    '@type': 'Person', name: person.name, givenName: person.given_name,
    familyName: person.family_name, affiliation: { '@type': 'Organization', name: person.affiliation },
    ...(person.orcid ? { sameAs: person.orcid } : {})
  };
}

function jsonLd(manifest) {
  const common = {
    '@context': 'https://schema.org/',
    '@type': isDataProduct(manifest) ? 'Dataset' : manifest.product_type === 'report' ? 'Report' : 'CreativeWork',
    '@id': manifest.canonical_url,
    name: manifest.title,
    description: manifest.description,
    url: manifest.canonical_url,
    identifier: [manifest.id, manifest.dois?.concept && doiUrl(manifest.dois.concept), manifest.dois?.version && doiUrl(manifest.dois.version)].filter(Boolean),
    version: manifest.version,
    datePublished: manifest.release_date,
    creator: manifest.creators.map(personJsonLd),
    publisher: { '@type': 'Organization', name: manifest.publisher.name, url: manifest.publisher.url, ...(manifest.publisher.ror ? { sameAs: manifest.publisher.ror } : {}) },
    keywords: manifest.keywords,
    license: manifest.licenses.data,
    isAccessibleForFree: true,
    ...(manifest.coverage?.temporal ? { temporalCoverage: manifest.coverage.temporal } : {}),
    ...(manifest.coverage?.spatial ? { spatialCoverage: manifest.coverage.spatial } : {}),
    ...(manifest.provenance.same_as.length ? { sameAs: manifest.provenance.same_as } : {}),
    ...(manifest.provenance.is_based_on.length ? { isBasedOn: manifest.provenance.is_based_on } : {}),
    distribution: manifest.distributions.map(item => ({
      '@type': 'DataDownload', name: path.basename(item.path), contentUrl: item.content_url,
      encodingFormat: item.encoding_format, contentSize: `${item.size_bytes} bytes`,
      sha256: item.sha256
    }))
  };
  return common;
}

function zenodo(manifest) {
  return {
    title: manifest.title,
    upload_type: isDataProduct(manifest) ? 'dataset' : 'publication',
    ...(manifest.product_type === 'report' ? { publication_type: 'report' } : {}),
    description: manifest.description,
    creators: manifest.creators.map(person => ({
      name: `${person.family_name}, ${person.given_name}`,
      affiliation: person.affiliation,
      ...(person.orcid ? { orcid: person.orcid.replace('https://orcid.org/', '') } : {})
    })),
    contributors: (manifest.contributors ?? []).map(person => ({
      name: `${person.family_name}, ${person.given_name}`, affiliation: person.affiliation,
      type: person.roles.includes('Data curation') ? 'DataCurator' : 'Researcher',
      ...(person.orcid ? { orcid: person.orcid.replace('https://orcid.org/', '') } : {})
    })),
    version: manifest.version.replace(/^v/, ''),
    publication_date: manifest.release_date,
    license: manifest.licenses.data,
    keywords: manifest.keywords,
    related_identifiers: [
      { identifier: manifest.canonical_url, relation: 'isIdenticalTo', resource_type: isDataProduct(manifest) ? 'dataset' : 'publication-report' },
      { identifier: manifest.repository_url, relation: 'isSupplementTo', resource_type: 'software' },
      ...manifest.provenance.is_based_on.map(identifier => ({ identifier, relation: 'isDerivedFrom', resource_type: 'dataset' }))
    ]
  };
}

function croissant(manifest) {
  return {
    '@context': {
      '@language': 'en',
      sc: 'https://schema.org/',
      cr: 'http://mlcommons.org/croissant/',
      dct: 'http://purl.org/dc/terms/'
    },
    '@type': 'sc:Dataset',
    conformsTo: 'http://mlcommons.org/croissant/1.1',
    name: manifest.title,
    description: manifest.description,
    url: manifest.canonical_url,
    version: manifest.version,
    license: manifest.licenses.data,
    creator: manifest.creators.map(personJsonLd),
    distribution: manifest.distributions.filter(item => ['data', 'chart-data'].includes(item.role)).map(item => ({
      '@type': 'cr:FileObject', '@id': item.path, name: path.basename(item.path),
      contentUrl: item.content_url, encodingFormat: item.encoding_format,
      sha256: item.sha256, contentSize: String(item.size_bytes)
    })),
    recordSet: [{
      '@type': 'cr:RecordSet', name: `${manifest.slug} records`,
      description: manifest.methodology.population,
      field: manifest.methodology.variables.map(variable => ({ '@type': 'cr:Field', name: variable, description: `Variable documented in ${manifest.methodology.file}.` }))
    }]
  };
}

function disclosure(manifest) {
  const d = manifest.disclosure;
  return `# Independence and conflicts disclosure

**Conclusion:** ${d.conclusion}

- **Funding:** ${d.funder}
- **Commissioned by:** ${d.commissioned_by}
- **Prepublication review:** ${d.prepublication_review}
- **Editorial control:** ${d.editorial_control}
- **Consideration:** ${d.consideration}
- **Conflicts:** ${d.conflicts}
- **Interested-party data:** ${d.interested_party_data}
- **AI use:** ${d.ai_use}
- **Independent review:** ${d.independent_review}
- **Material limitations:** ${d.limitations}
- **Corrections:** ${d.corrections}
- **Accountable review status:** ${d.review_status}
`;
}

function hfCard(manifest) {
  const hf = manifest.huggingface ?? {};
  const yamlList = (name, values = []) => [name + ':', ...values.map(value => `- ${JSON.stringify(value)}`)].join('\n');
  return `---
${yamlList('language', hf.language ?? ['en'])}
pretty_name: ${JSON.stringify(manifest.title)}
license: ${JSON.stringify(manifest.licenses.data.toLowerCase())}
${yamlList('tags', [...new Set([...(hf.tags ?? []), 'mlcroissant'])])}
${yamlList('task_categories', hf.task_categories ?? [])}
size_categories:
- ${JSON.stringify(hf.size_category ?? 'n<1K')}
configs:
- config_name: default
  data_files:
  - split: train
    path: ${JSON.stringify(`data/${manifest.slug}.csv`)}
---

# ${manifest.title}

${manifest.description}

## Dataset structure

${manifest.methodology.population}

Variables: ${manifest.methodology.variables.join(', ')}.

## Provenance and methodology

See ${manifest.methodology.file} and ${manifest.provenance.source_inventory} in the release package.

## Intended uses

Use for transparent analysis, comparison, and reproducible charting within the scope documented in the methodology.

## Limitations and bias

${manifest.methodology.limitations.map(item => `- ${item}`).join('\n')}

## Creators

${manifest.creators.map(person => `- ${person.name} (${person.roles.join('; ')})${person.orcid ? ` — ${person.orcid}` : ''}`).join('\n')}

## Citation

Use CITATION.cff. Cite the exact-version DOI when available; the concept DOI refers to the evolving product.

## Independence

${manifest.disclosure.conclusion}. See DISCLOSURE.md for the complete statement.
`;
}

function downloads(manifest) {
  const lines = manifest.distributions.map(item => `| [${path.basename(item.path)}](${item.path}) | ${item.role} | ${item.encoding_format} | ${item.size_bytes} | \`${item.sha256}\` |`).join('\n');
  return `# Downloads

Version: **${manifest.version}**

| File | Role | Format | Bytes | SHA-256 |
|---|---|---|---:|---|
${lines}

The links above are local paths in this release package. Public URLs are recorded in the canonical manifest.
`;
}

function releaseNotes(manifest) {
  return `# ${manifest.title} ${manifest.version}

Release date: ${manifest.release_date}  
Status: ${manifest.status}  
Classification: ${manifest.classification}

${manifest.release.change_summary}

## Citation

${manifest.dois?.version ? `Exact version DOI: https://doi.org/${manifest.dois.version}` : 'Exact version DOI: pending.'}  
${manifest.dois?.concept ? `Concept DOI: https://doi.org/${manifest.dois.concept}` : 'Concept DOI: pending.'}

## Publication status

Publication authorized: **${manifest.publication_authorized ? 'yes' : 'no'}**. Status: **${manifest.status}**.
`;
}

export async function generateProduct(productDir) {
  const manifest = await loadManifest(productDir);
  await ensureDir(path.join(productDir, 'metadata'));
  await ensureDir(path.join(productDir, 'provenance'));
  await writeText(path.join(productDir, 'CITATION.cff'), cff(manifest));
  await writeJson(path.join(productDir, 'metadata/research-product.jsonld'), jsonLd(manifest));
  await writeJson(path.join(productDir, 'metadata/zenodo.json'), zenodo(manifest));
  if (isDataProduct(manifest)) {
    await writeJson(path.join(productDir, 'metadata/croissant.json'), croissant(manifest));
    await writeText(path.join(productDir, 'README.huggingface.md'), hfCard(manifest));
  }
  await writeText(path.join(productDir, 'DISCLOSURE.md'), disclosure(manifest));
  await writeText(path.join(productDir, 'DOWNLOADS.md'), downloads(manifest));
  await writeText(path.join(productDir, 'RELEASE_NOTES.md'), releaseNotes(manifest));
  if (manifest.charts.length) {
    await writeText(path.join(productDir, 'charts/charts-manifest.csv'), rowsToCsv(
      ['product_slug', 'product_version', 'coverage', 'chart_slug', 'title', 'summary', 'alt', 'csv', 'svg', 'png', 'source_notes', 'license'],
      manifest.charts.map(chart => ({
        product_slug: manifest.slug, product_version: manifest.version,
        coverage: manifest.coverage?.temporal ?? '', chart_slug: chart.slug,
        title: chart.title, summary: chart.summary, alt: chart.alt,
        csv: chart.csv, svg: chart.svg, png: chart.png,
        source_notes: chart.source_notes, license: chart.license
      }))
    ));
  }
  const generated = ['research-manifest.yaml', 'CITATION.cff', 'DISCLOSURE.md', 'DOWNLOADS.md', 'RELEASE_NOTES.md', 'metadata/research-product.jsonld', 'metadata/zenodo.json'];
  if (isDataProduct(manifest)) generated.push('metadata/croissant.json', 'README.huggingface.md');
  if (manifest.charts.length) generated.push('charts/charts-manifest.csv');
  for (const relative of ['LICENSE-DATA.md', 'LICENSE-CODE.md', 'LICENSE-CONTENT.md', 'CHANGELOG.md']) {
    try { await stat(path.join(productDir, relative)); generated.push(relative); } catch {}
  }
  const payload = [...new Set([...generated, ...manifest.distributions.map(item => item.path), ...manifest.charts.flatMap(chart => [chart.csv, chart.svg, chart.png, `charts/${chart.slug}.alt.txt`])])].sort();
  const descriptors = [];
  for (const relative of payload) descriptors.push(await fileDescriptor(productDir, relative));
  await writeText(path.join(productDir, 'provenance/checksums.sha256'), descriptors.map(item => `${item.sha256}  ${item.path}`).join('\n'));
  await writeJson(path.join(productDir, 'release-payload.json'), {
    schema_version: 'kingy-release-payload-v1', product_id: manifest.id, version: manifest.version,
    local_candidate_only: !manifest.publication_authorized, files: descriptors
  });
  return { productDir, manifest, files: descriptors.length };
}

async function main() {
  const targets = process.argv.slice(2);
  const productDirs = targets.length ? targets.map(target => path.resolve(target)) : (await readdir(path.join(PACKAGE_ROOT, 'pilots'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => path.join(PACKAGE_ROOT, 'pilots', entry.name));
  for (const productDir of productDirs) {
    const result = await generateProduct(productDir);
    process.stdout.write(`generated ${result.manifest.slug}: ${result.files} payload files\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main().catch(error => { console.error(error); process.exitCode = 1; });
