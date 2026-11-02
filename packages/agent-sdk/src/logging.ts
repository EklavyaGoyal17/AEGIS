export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, event: string, fields: Record<string, unknown>): void;
}

export const noopLogger: Logger = { log: () => undefined };

/** One JSON object per line on stderr. Fields are redacted before they reach this logger. */
export const jsonLogger: Logger = {
  log(level, event, fields) {
    process.stderr.write(`${JSON.stringify({ level, event, time: new Date().toISOString(), ...fields })}\n`);
  },
};

const SENSITIVE_KEY = /(authorization|token|secret|password|passwd|api[-_]?key|credential|cookie|session|private|arguments|args|context|attributes)/i;
const MAX_STRING = 256;
const MAX_DEPTH = 4;

/**
 * Redacts values under sensitive keys (credentials, tokens, tool arguments, caller context, attributes),
 * truncates long strings and bounds depth. Applied by the SDK to every field it logs.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  if (depth >= MAX_DEPTH) return '[depth-limit]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return `[${typeof value}]`;
}

export function safeLog(logger: Logger, level: LogLevel, event: string, fields: Record<string, unknown>): void {
  try {
    logger.log(level, event, redact(fields) as Record<string, unknown>);
  } catch {
    // Logging must never change authorization behaviour.
  }
}
