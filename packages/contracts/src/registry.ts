import type { TSchema } from '@sinclair/typebox';
import * as api from './api.js';
import * as entities from './entities.js';
import * as policy from './policy.js';
import * as primitives from './primitives.js';

/**
 * Every named schema of the v1 contract, keyed by its `$id`. This is the single source from which the
 * OpenAPI document and the JSON Schema bundle are generated.
 */
export const SCHEMAS: Readonly<Record<string, TSchema>> = Object.freeze(collect());

function collect(): Record<string, TSchema> {
  const out: Record<string, TSchema> = {};
  for (const mod of [primitives, policy, entities, api]) {
    for (const value of Object.values(mod)) {
      if (isSchema(value) && typeof value.$id === 'string') {
        const existing = out[value.$id];
        if (existing && existing !== value) throw new Error(`duplicate schema $id ${value.$id}`);
        out[value.$id] = value;
      }
    }
  }
  return out;
}

function isSchema(value: unknown): value is TSchema {
  return typeof value === 'object' && value !== null && Symbol.for('TypeBox.Kind') in value;
}

export type SchemaName = keyof typeof SCHEMAS & string;
