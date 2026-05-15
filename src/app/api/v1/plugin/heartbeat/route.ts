import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { log, toLogError } from "@/lib/logger";

const startTime = Date.now();

// ── Subsystem Check Types ─────────────────────────────────────────

interface SubsystemCheck {
  status: "ok" | "error" | "missing";
  latencyMs?: number;
  detail?: string;
}

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  product: "finance";
  version: "0.1.0";
  uptime: { ms: number; human: string };
  checks: {
    database: SubsystemCheck;
    stripe: SubsystemCheck;
    razorpay: SubsystemCheck;
    gmail: SubsystemCheck;
    gemini: SubsystemCheck;
    sentry: SubsystemCheck;
    memory: SubsystemCheck & { heapUsedMB?: number; heapTotalMB?: number };
  };
  activeUsers: number;
  timestamp: string;
}

// ── Individual Checks ─────────────────────────────────────────────

async function checkDatabase(): Promise<SubsystemCheck> {
  const start = performance.now();
  try {
    await Promise.race([
      prisma.$queryRawUnsafe("SELECT 1"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DB timeout")), 2000)
      ),
    ]);
    return { status: "ok", latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Math.round(performance.now() - start),
      detail: err instanceof Error ? err.message : "Unknown DB error",
    };
  }
}

function checkEnvVar(name: string): SubsystemCheck {
  return process.env[name]
    ? { status: "ok" }
    : { status: "missing", detail: `${name} not set` };
}

function checkMemory(): SubsystemCheck & { heapUsedMB?: number; heapTotalMB?: number } {
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  return {
    status: heapUsedMB < 512 ? "ok" : "error",
    heapUsedMB,
    heapTotalMB,
    ...(heapUsedMB >= 512 && { detail: `Heap usage ${heapUsedMB}MB exceeds 512MB threshold` }),
  };
}

// ── Aggregate Status ──────────────────────────────────────────────

function aggregateStatus(
  checks: HealthResponse["checks"]
): "healthy" | "degraded" | "unhealthy" {
  const allChecks = Object.values(checks);

  // If any critical check is "error" → unhealthy
  if (checks.database.status === "error" || checks.memory.status === "error") {
    return "unhealthy";
  }

  // If any check is "error" → unhealthy
  if (allChecks.some((c) => c.status === "error")) {
    return "unhealthy";
  }

  // If any check is "missing" but DB is ok → degraded
  if (allChecks.some((c) => c.status === "missing")) {
    return "degraded";
  }

  return "healthy";
}

// ── Uptime Formatter ──────────────────────────────────────────────

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * GET /api/v1/plugin/heartbeat
 *
 * Returns health status for the Founder OS orchestrator.
 * Used by the heartbeat protocol to monitor sidechain health.
 *
 * Checks: Database, Stripe, RazorpayX, Gmail, Gemini AI, Sentry, Memory.
 */
export async function GET() {
  const uptimeMs = Date.now() - startTime;

  try {
    // Run all checks concurrently
    // TENANT: heartbeat is a global health check — user.count is platform-wide,
    // not scoped to organizationId (intentional for ops monitoring)
    const [dbCheck, activeUsers] = await Promise.all([
      checkDatabase(),
      prisma.user
        .count({
          where: {
            updatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        })
        .catch(() => 0),
    ]);

    const checks: HealthResponse["checks"] = {
      database: dbCheck,
      stripe: checkEnvVar("STRIPE_SECRET_KEY"),
      razorpay: checkEnvVar("RAZORPAY_KEY_ID"),
      gmail: checkEnvVar("GOOGLE_CLIENT_ID"),
      gemini: checkEnvVar("GEMINI_API_KEY"),
      sentry: checkEnvVar("SENTRY_DSN"),
      memory: checkMemory(),
    };

    const status = aggregateStatus(checks);

    const response: HealthResponse = {
      status,
      product: "finance",
      version: "0.1.0",
      uptime: { ms: uptimeMs, human: formatUptime(uptimeMs) },
      checks,
      activeUsers,
      timestamp: new Date().toISOString(),
    };

    log.info("Heartbeat check completed", {
      module: "heartbeat",
      action: "check",
      meta: {
        status,
        dbLatencyMs: dbCheck.latencyMs,
        activeUsers,
      },
    });

    return NextResponse.json(response, {
      status: status === "unhealthy" ? 503 : 200,
    });
  } catch (error) {
    log.error("Heartbeat check failed", {
      module: "heartbeat",
      action: "check",
      error: toLogError(error),
    });

    return NextResponse.json(
      {
        status: "unhealthy",
        product: "finance",
        version: "0.1.0",
        uptime: { ms: uptimeMs, human: formatUptime(uptimeMs) },
        checks: {
          database: { status: "error" as const, detail: "Check failed" },
          stripe: { status: "missing" as const },
          razorpay: { status: "missing" as const },
          gmail: { status: "missing" as const },
          gemini: { status: "missing" as const },
          sentry: { status: "missing" as const },
          memory: { status: "error" as const },
        },
        activeUsers: 0,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
