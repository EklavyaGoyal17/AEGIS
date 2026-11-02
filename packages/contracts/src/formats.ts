import { FormatRegistry } from '@sinclair/typebox';

/** Canonical lowercase UUID (any version). Uppercase is rejected so one ID has exactly one spelling. */
export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

/** RFC 3339 timestamp restricted to UTC ("Z"), optional fractional seconds up to nanoseconds. */
export const RFC3339_UTC_PATTERN =
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?Z$';

const uuidRe = new RegExp(UUID_PATTERN);
const rfc3339Re = new RegExp(RFC3339_UTC_PATTERN);

export function isUuid(value: string): boolean {
  return uuidRe.test(value);
}

/**
 * Validates syntax AND calendar semantics (rejects 2026-02-30T00:00:00Z, hour 24, etc.).
 * Leap seconds (":60") are rejected; AEGIS timestamps are produced by servers that smear.
 */
export function isRfc3339Utc(value: string): boolean {
  if (!rfc3339Re.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  if (month < 1 || month > 12) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

let registered = false;

/** Idempotently registers the formats used by AEGIS schemas with this package's TypeBox instance. */
export function registerFormats(): void {
  if (registered) return;
  if (!FormatRegistry.Has('uuid')) FormatRegistry.Set('uuid', isUuid);
  if (!FormatRegistry.Has('date-time')) FormatRegistry.Set('date-time', isRfc3339Utc);
  registered = true;
}

registerFormats();
