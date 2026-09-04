# OpenAI and Anthropic API Price Index — August 2026

A versioned research release containing normalized OpenAI and Anthropic API price records, source identifiers, methodology, machine-readable metadata, and a reusable provider-level chart bundle.

Version: **v2026.08.0** · Released: **2026-08-24**

[Canonical page](https://kingy.ai/kapi/price-index/) · [Exact-version DOI](https://doi.org/10.5281/zenodo.22288588) · [Concept DOI](https://doi.org/10.5281/zenodo.22288587) · [Hugging Face dataset](https://huggingface.co/datasets/CurtisPyke/openai-anthropic-price-index)

## Researcher and independence

Research lead: **Curtis Pyke**, Kingy AI. Independently funded. No external funding or sponsorship; the work was conducted by Kingy AI. Curtis Pyke declared no relevant financial or personal conflicts for these research products.

See [DISCLOSURE.md](DISCLOSURE.md), [methodology.md](methodology.md), and [CITATION.cff](CITATION.cff) for the full governance, methods, and citation record.

## Downloads

| File | Role | Format | SHA-256 |
|---|---|---|---|
| [`data/release/openai-anthropic-price-index.csv`](data/release/openai-anthropic-price-index.csv) | data | text/csv | `fdefae09248e90ccf59ef9bda621b0bdc7ba27e0aabd2e91169873e36e568ae9` |
| [`data/release/openai-anthropic-price-index.json`](data/release/openai-anthropic-price-index.json) | data | application/json | `dbf6b7de07db9338467a657b7e264a1cecd9bc42ab791328cb031260cbdebd07` |
| [`data/release/openai-anthropic-price-index.schema.json`](data/release/openai-anthropic-price-index.schema.json) | schema | application/schema+json | `59730c799d2070a88bf2501db17095e3172f7111d35a119eeb9a92264a0d8935` |
| [`methodology.md`](methodology.md) | methodology | text/markdown | `5b9815f60b2ffc6f42b74acd53e8a3ade0cd0e93bd1fa0baa593bb2fab72422e` |
| [`data-dictionary.csv`](data-dictionary.csv) | schema | text/csv | `330ea370e83547e3f75dec25d1c8cf10a225ba93ec28a3555da7c09e58a8d951` |
| [`provenance/source-capture-manifest.json`](provenance/source-capture-manifest.json) | source-manifest | application/json | `412b5e5af677c6f47b0269c4a277c90979f8f3899cfc3e4bdbde8328f2dc16dc` |
| [`provenance/sources.csv`](provenance/sources.csv) | source-manifest | text/csv | `53bc0c0a1b3bb373ba756bb3fde982895714ac1efe273bd431257bd12ad1374c` |

Downloadable chart data, SVG, PNG, and alt text are in [charts/](charts/). File-level integrity is recorded in [provenance/checksums.sha256](provenance/checksums.sha256).

## Reproduce and validate

The release includes the schema-driven metadata generator, accessible chart rebuild, and validation gate used to package the research. Run `npm test` to verify the manifest, generated metadata, distributions, charts, checksums, and secret scan. Run `npm run generate` or `npm run rebuild:charts` only when preparing a new immutable version.

## Citation

Cite the exact files used with **https://doi.org/10.5281/zenodo.22288588**. Use the concept DOI **https://doi.org/10.5281/zenodo.22288587** when referring to the evolving product across versions.

## Licenses

Data: CC BY 4.0 · Code: MIT · Content and charts: CC BY 4.0. See the three license files for details.
