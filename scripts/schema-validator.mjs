import path from 'node:path';
import { PACKAGE_ROOT, readJson } from './lib.mjs';

function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`Only local JSON Schema references are supported: ${ref}`);
  return ref.slice(2).split('/').reduce((value, key) => value[key.replaceAll('~1', '/').replaceAll('~0', '~')], root);
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function inspect(value, schema, root, location, errors) {
  if (schema.$ref) return inspect(value, resolveRef(root, schema.$ref), root, location, errors);
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(candidate => {
      const candidateErrors = [];
      inspect(value, candidate, root, location, candidateErrors);
      return candidateErrors.length === 0;
    });
    if (matches.length !== 1) errors.push(`${location}: expected exactly one oneOf branch, matched ${matches.length}`);
    return;
  }
  const types = schema.type == null ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length && !types.some(type => typeMatches(value, type))) {
    errors.push(`${location}: expected ${types.join(' or ')}`);
    return;
  }
  if ('const' in schema && !same(value, schema.const)) errors.push(`${location}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some(option => same(value, option))) errors.push(`${location}: is not an allowed enum value`);
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${location}: shorter than minLength ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${location}: longer than maxLength ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${location}: does not match required pattern`);
    if (schema.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) errors.push(`${location}: is not a valid full date`);
  }
  if (typeof value === 'number' && schema.minimum != null && value < schema.minimum) errors.push(`${location}: below minimum ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${location}: has fewer than ${schema.minItems} items`);
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) errors.push(`${location}: contains duplicate items`);
    if (schema.items) value.forEach((item, index) => inspect(item, schema.items, root, `${location}[${index}]`, errors));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required ?? []) if (!(required in value)) errors.push(`${location}.${required}: required property is missing`);
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in properties)) errors.push(`${location}.${key}: additional property is not allowed`);
    for (const [key, childSchema] of Object.entries(properties)) if (key in value) inspect(value[key], childSchema, root, `${location}.${key}`, errors);
  }
}

export async function validateManifestSchema(manifest) {
  const schema = await readJson(path.join(PACKAGE_ROOT, 'contracts/research-manifest.schema.json'));
  const errors = [];
  inspect(manifest, schema, schema, '$', errors);
  return errors;
}

