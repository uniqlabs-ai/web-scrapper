import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

// TENANT: auth routes are pre-tenant — user.upsert operates by email identity,
// organizationId is assigned post-authentication via onboarding flow

const AuthSchema = z.object({
  email: z.string().email("Valid email is required"),
  fullName: z.string().max(200).optional(),
});

export async function GET() {
  try {
    const userId = "demo-user";

    const user = await prisma.user.upsert({
      where: { email: "demo@finance.app" },
      update: {},
      create: {
        id: userId,
        email: "demo@finance.app",
        fullName: "Demo User",
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    log.error("[Auth GET] Error", { module: "auth", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = AuthSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { email, fullName } = parsed.data;

    const user = await prisma.user.upsert({
      where: { email },
      update: { fullName },
      create: { email, fullName },
    });

    return NextResponse.json({ user });
  } catch (error) {
    log.error("[Auth POST] Error", { module: "auth", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
