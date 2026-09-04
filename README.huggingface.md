---
language:
- "en"
pretty_name: "OpenAI and Anthropic API Price Index — August 2026"
license: "cc-by-4.0"
tags:
- "pricing"
- "openai"
- "anthropic"
- "mlcroissant"
task_categories:
- "tabular-classification"
size_categories:
- "n<1K"
---

# OpenAI and Anthropic API Price Index — August 2026

A versioned local migration candidate containing normalized OpenAI and Anthropic API price records, source identifiers, methodology, machine-readable metadata, and a reusable provider-level chart bundle.

## Dataset structure

The 212 normalized price records in the focused nine-offering OpenAI and Anthropic refresh.

Variables: provider_id, model_id, price_component, native_amount, native_unit, normalized_usd_per_1m_tokens, observed_at, source_ids.

## Provenance and methodology

See methodology.md and provenance/sources.csv in the release package.

## Intended uses

Use for transparent analysis, comparison, and reproducible charting within the scope documented in the methodology.

## Limitations and bias

- Not a market census
- Prices and product terms can change
- Redistribution and licensing remain pending

## Creators

- Curtis Pyke (Conceptualization; Data curation; Formal analysis; Methodology; Validation; Visualization; Writing – original draft)

## Citation

Use CITATION.cff. Cite the exact-version DOI when available; the concept DOI refers to the evolving product.

## Independence

Independently funded. See DISCLOSURE.md for the complete statement.
