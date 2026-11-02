import { SENSITIVITY_ORDER, type Sensitivity, type TimeWindow } from '@aegis/contracts';

/** Segment-aligned action matching: "*", exact, or "ns.*" (matches "ns.<anything>", never "nsx.read"). */
export function actionMatches(pattern: string, action: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return action.startsWith(pattern.slice(0, -1));
  return pattern === action;
}

export function resourceTypeMatches(pattern: string, type: string): boolean {
  return pattern === '*' || pattern === type;
}

/** Does pattern `a` match every action that pattern `b` matches? */
export function actionPatternCovers(a: string, b: string): boolean {
  if (a === '*') return true;
  if (b === '*') return false;
  if (a.endsWith('.*')) {
    const prefix = a.slice(0, -1);
    return b.startsWith(prefix);
  }
  return !b.endsWith('.*') && a === b;
}

export function actionPatternsOverlap(a: string, b: string): boolean {
  return actionPatternCovers(a, b) || actionPatternCovers(b, a);
}

export function resourceTypePatternCovers(a: string, b: string): boolean {
  return a === '*' || a === b;
}

const RESTRICTED = SENSITIVITY_ORDER.restricted;

/** Missing or unrecognised sensitivity is treated as the most sensitive level. */
export function sensitivityLevel(value: unknown): number {
  if (typeof value === 'string' && Object.hasOwn(SENSITIVITY_ORDER, value)) {
    return SENSITIVITY_ORDER[value as Sensitivity];
  }
  return RESTRICTED;
}

export function sensitivityInRange(level: number, range: { min?: Sensitivity; max?: Sensitivity }): boolean {
  if (range.min !== undefined && level < SENSITIVITY_ORDER[range.min]) return false;
  if (range.max !== undefined && level > SENSITIVITY_ORDER[range.max]) return false;
  return true;
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/**
 * Parses an already-validated RFC 3339 UTC timestamp into epoch milliseconds without relying on
 * Date.parse leniency (sub-millisecond digits are truncated).
 */
export function parseTimestamp(ts: string): number {
  // "YYYY-MM-DDTHH:MM:SS[.fraction]Z": the fraction (if any) sits between index 20 and the trailing "Z".
  const ms = ts.length > 20 ? Number(ts.slice(20, -1).padEnd(3, '0').slice(0, 3)) : 0;
  return Date.UTC(
    Number(ts.slice(0, 4)),
    Number(ts.slice(5, 7)) - 1,
    Number(ts.slice(8, 10)),
    Number(ts.slice(11, 13)),
    Number(ts.slice(14, 16)),
    Number(ts.slice(17, 19)),
    ms,
  );
}

export function hhmmToMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export function offsetToMinutes(offset: string): number {
  const sign = offset.startsWith('-') ? -1 : 1;
  return sign * hhmmToMinutes(offset.slice(1));
}

export function inTimeWindow(nowMs: number, window: TimeWindow): boolean {
  const local = new Date(nowMs + offsetToMinutes(window.utcOffset) * 60_000);
  const day = DAYS[local.getUTCDay()]!;
  if (!window.days.includes(day)) return false;
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minutes >= hhmmToMinutes(window.start) && minutes < hhmmToMinutes(window.end);
}
