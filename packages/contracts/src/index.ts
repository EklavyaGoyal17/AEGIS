// Re-exported so dependent packages build schemas with this package's TypeBox instance (shared format registry).
export { Type } from '@sinclair/typebox';
export type { Static, TSchema } from '@sinclair/typebox';
export * from './formats.js';
export * from './limits.js';
export * from './reason-codes.js';
export * from './primitives.js';
export * from './policy.js';
export * from './entities.js';
export * from './api.js';
export * from './canonical.js';
export * from './validate.js';
export { SCHEMAS } from './registry.js';
export { buildOpenApi, buildJsonSchemaBundle, toJsonSchema, JSON_SCHEMA_BUNDLE_ID } from './openapi/build.js';
