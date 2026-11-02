import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import './formats.js';

export interface ValidationIssue {
  /** JSON Pointer to the offending value ("" for the root). */
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const MAX_ISSUES = 20;

/**
 * Validates `value` against a contract schema without coercion, defaults or mutation. Unknown
 * properties are rejected wherever the schema says `additionalProperties: false`.
 * Never throws for any input value.
 */
export function validate<S extends TSchema>(schema: S, value: unknown): ValidationResult<Static<S>> {
  try {
    if (Value.Check(schema, value)) return { ok: true, value: value as Static<S> };
    const issues: ValidationIssue[] = [];
    for (const error of Value.Errors(schema, value)) {
      issues.push({ path: error.path, message: error.message });
      if (issues.length >= MAX_ISSUES) break;
    }
    if (issues.length === 0) issues.push({ path: '', message: 'value does not match schema' });
    return { ok: false, issues };
  } catch (err) {
    return { ok: false, issues: [{ path: '', message: `validation failed: ${(err as Error).message}` }] };
  }
}

export function isValid<S extends TSchema>(schema: S, value: unknown): value is Static<S> {
  return validate(schema, value).ok;
}
