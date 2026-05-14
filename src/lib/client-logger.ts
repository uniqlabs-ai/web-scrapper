/**
 * Client-side Logger — FoundrOS Finance
 *
 * Lightweight structured logger for "use client" page components.
 * Mirrors the server-side @/lib/logger API but is safe for browser context.
 *
 * Usage:
 *   import { clientLog } from '@/lib/client-logger';
 *   clientLog.error("Failed to load data", "invoices", "load", err);
 *   clientLog.warn("Retry succeeded", "bank", "import");
 */

type LogLevel = "debug" | "info" | "warn" | "error";

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function emit(level: LogLevel, message: string, module: string, action: string, err?: unknown): void {
  const prefix = `[${module}/${action}]`;
  const parts = [prefix, message];
  if (err) parts.push(`→ ${formatError(err)}`);
  const output = parts.join(" ");

  switch (level) {
    case "debug":
      // eslint-disable-next-line no-console
      if (process.env.NODE_ENV !== "production") console.debug(output);
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
      // eslint-disable-next-line no-console
      console.error(output);
      break;
  }
}

/**
 * Client-side structured logger.
 *
 * @example
 * clientLog.error("Failed to load accounts", "bank", "load", err);
 * clientLog.warn("Retrying...", "reconciliation", "match");
 */
export const clientLog = {
  debug: (message: string, module: string, action: string, err?: unknown) =>
    emit("debug", message, module, action, err),
  info: (message: string, module: string, action: string, err?: unknown) =>
    emit("info", message, module, action, err),
  warn: (message: string, module: string, action: string, err?: unknown) =>
    emit("warn", message, module, action, err),
  error: (message: string, module: string, action: string, err?: unknown) =>
    emit("error", message, module, action, err),
};
