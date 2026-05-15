/**
 * Structured Logger — FoundrOS Finance
 *
 * Replaces raw console.* calls with structured JSON logs for
 * Vercel log drain, Sentry breadcrumbs, and production debugging.
 *
 * Usage:
 *   import { log } from '@/lib/logger';
 *   log.info("Invoice created", { module: "invoices", action: "create", userId, orgId });
 *   log.error("Payment failed", { module: "billing", action: "charge", error: { message, name, stack } });
 */

// ── Types ────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface LogContext {
  /** Module originating the log (e.g., 'invoices', 'webhooks', 'payroll') */
  module: string;
  /** Action being performed (e.g., 'create', 'parse', 'dispatch') */
  action: string;
  /** Authenticated user ID */
  userId?: string;
  /** Tenant organization ID */
  orgId?: string;
  /** Resource being acted upon */
  resourceId?: string;
  /** Resource type (e.g., 'invoice', 'expense', 'bankTransaction') */
  resourceType?: string;
  /** Operation duration in milliseconds */
  durationMs?: number;
  /** Structured error info */
  error?: {
    message: string;
    name: string;
    stack?: string;
    digest?: string;
  };
  /** Additional metadata (auto-sanitized of secrets) */
  meta?: Record<string, unknown>;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  environment: string;
  module: string;
  action: string;
  userId?: string;
  orgId?: string;
  resourceId?: string;
  resourceType?: string;
  durationMs?: number;
  error?: {
    message: string;
    name: string;
    stack?: string;
    digest?: string;
  };
  meta?: Record<string, unknown>;
}

// ── Sensitive Key Filter ─────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  "token",
  "secret",
  "password",
  "passwd",
  "key",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "client_secret",
  "clientsecret",
  "private_key",
  "privatekey",
  "signing_key",
  "encryption_key",
  "webhook_secret",
  "dsn",
  "credentials",
  "bearer",
  "jwt",
  "session",
  "pan",
  "aadhaar",
]);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[-_]/g, "");
  return SENSITIVE_KEYS.has(lower) || SENSITIVE_KEYS.has(key.toLowerCase());
}

function sanitizeMeta(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      sanitized[key] = sanitizeMeta(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ── Stack Truncation ─────────────────────────────────────────────────

const MAX_STACK_LENGTH = 500;

function truncateStack(stack?: string): string | undefined {
  if (!stack) return undefined;
  return stack.length > MAX_STACK_LENGTH
    ? stack.slice(0, MAX_STACK_LENGTH) + "…"
    : stack;
}

// ── Core Log Function ────────────────────────────────────────────────

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const MIN_LEVEL: LogLevel =
  process.env.NODE_ENV === "production" ? "info" : "debug";

const isProduction = process.env.NODE_ENV === "production";
const environment = process.env.NODE_ENV || "development";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[MIN_LEVEL];
}

function buildEntry(
  level: LogLevel,
  message: string,
  context: LogContext
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    environment,
    module: context.module,
    action: context.action,
    ...(context.userId && { userId: context.userId }),
    ...(context.orgId && { orgId: context.orgId }),
    ...(context.resourceId && { resourceId: context.resourceId }),
    ...(context.resourceType && { resourceType: context.resourceType }),
    ...(context.durationMs !== undefined && {
      durationMs: context.durationMs,
    }),
    ...(context.error && {
      error: {
        message: context.error.message,
        name: context.error.name,
        stack: truncateStack(context.error.stack),
        ...(context.error.digest && { digest: context.error.digest }),
      },
    }),
    ...(context.meta && { meta: sanitizeMeta(context.meta) }),
  };
}

// ── Dev Formatting ───────────────────────────────────────────────────

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",   // gray
  info: "\x1b[36m",    // cyan
  warn: "\x1b[33m",    // yellow
  error: "\x1b[31m",   // red
  fatal: "\x1b[35m",   // magenta
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function formatDev(entry: LogEntry): string {
  const color = LEVEL_COLORS[entry.level];
  const lvl = entry.level.toUpperCase().padEnd(5);
  const mod = `${BOLD}[${entry.module}/${entry.action}]${RESET}`;
  const parts = [`${color}${lvl}${RESET}`, mod, entry.message];

  if (entry.userId) parts.push(`uid:${entry.userId.slice(0, 8)}`);
  if (entry.durationMs !== undefined) parts.push(`${entry.durationMs}ms`);
  if (entry.error) parts.push(`\n  → ${entry.error.name}: ${entry.error.message}`);
  if (entry.meta && Object.keys(entry.meta).length > 0) {
    parts.push(`\n  meta: ${JSON.stringify(entry.meta)}`);
  }

  return parts.join(" ");
}

// ── Output ───────────────────────────────────────────────────────────

function emit(level: LogLevel, entry: LogEntry): void {
  const output = isProduction
    ? JSON.stringify(entry)
    : formatDev(entry);

  // Route to the correct native console method for Vercel log severity
  switch (level) {
    case "debug":
      // eslint-disable-next-line no-console
      console.debug(output);
      break;
    case "info":
      // eslint-disable-next-line no-console
      console.info(output);
      break;
    case "warn":
      // eslint-disable-next-line no-console
      console.warn(output);
      break;
    case "error":
    case "fatal":
      // eslint-disable-next-line no-console
      console.error(output);
      break;
  }
}

// ── Sentry Integration ──────────────────────────────────────────────

let _sentry: typeof import("@sentry/nextjs") | null = null;
let _sentryLoaded = false;

function getSentry() {
  if (_sentryLoaded) return _sentry;
  _sentryLoaded = true;
  try {
    // Dynamic require — avoids import cycle and works when Sentry isn't configured
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _sentry = require("@sentry/nextjs");
  } catch {
    _sentry = null;
  }
  return _sentry;
}

function captureToSentry(level: LogLevel, message: string, context: LogContext): void {
  if (level !== "error" && level !== "fatal") return;
  const sentry = getSentry();
  if (!sentry) return;

  try {
    // If we have a real error object in context, capture it with structured extras
    if (context.error) {
      const err = new Error(context.error.message);
      err.name = context.error.name;
      sentry.captureException(err, {
        tags: {
          module: context.module,
          action: context.action,
          level,
        },
        extra: {
          ...(context.meta && sanitizeMeta(context.meta)),
          userId: context.userId,
          orgId: context.orgId,
          resourceId: context.resourceId,
          resourceType: context.resourceType,
          durationMs: context.durationMs,
        },
      });
    } else {
      // No error object — capture as a message with error severity
      sentry.captureMessage(message, {
        level: level === "fatal" ? "fatal" : "error",
        tags: { module: context.module, action: context.action },
        extra: context.meta ? sanitizeMeta(context.meta) : undefined,
      });
    }
  } catch {
    // Sentry capture itself failed — don't recurse, just emit to console
  }
}

// ── Public API ───────────────────────────────────────────────────────

function logFn(level: LogLevel, message: string, context: LogContext): void {
  if (!shouldLog(level)) return;
  const entry = buildEntry(level, message, context);
  emit(level, entry);
  captureToSentry(level, message, context);
}

/**
 * Structured logger with convenience methods.
 *
 * @example
 * log.info("Invoice created", { module: "invoices", action: "create" });
 * log.error("Payment failed", { module: "billing", action: "charge", error: { message: e.message, name: e.name } });
 */
export const log = {
  debug: (message: string, context: LogContext) =>
    logFn("debug", message, context),
  info: (message: string, context: LogContext) =>
    logFn("info", message, context),
  warn: (message: string, context: LogContext) =>
    logFn("warn", message, context),
  error: (message: string, context: LogContext) =>
    logFn("error", message, context),
  fatal: (message: string, context: LogContext) =>
    logFn("fatal", message, context),
};

// ── Utility: Error to LogContext.error ────────────────────────────────

/**
 * Convert an unknown catch-block value to the structured error shape.
 *
 * @example
 * } catch (err) {
 *   log.error("Failed", { module: "x", action: "y", error: toLogError(err) });
 * }
 */
export function toLogError(
  err: unknown
): { message: string; name: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message, name: err.name, stack: err.stack };
  }
  return { message: String(err), name: "UnknownError" };
}

// ── Utility: Duration Wrapper ────────────────────────────────────────

/**
 * Wrap an async function and auto-log its execution duration.
 *
 * @example
 * const result = await withDuration(
 *   () => prisma.invoice.findMany({ where: { userId } }),
 *   { module: "invoices", action: "list" }
 * );
 */
export async function withDuration<T>(
  fn: () => Promise<T>,
  context: Omit<LogContext, "durationMs">
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - start);
    log.info(`${context.module}/${context.action} completed`, {
      ...context,
      durationMs,
    });
    return result;
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    log.error(`${context.module}/${context.action} failed`, {
      ...context,
      durationMs,
      error: toLogError(err),
    });
    throw err;
  }
}
