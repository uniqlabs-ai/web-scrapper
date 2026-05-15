import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, getOrCreateSessionUser } from "@/lib/auth";
import { log, toLogError } from "@/lib/logger";
import { OnboardingCompleteSchema } from "@/lib/schemas";

// GET: Check onboarding status
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ needsAuth: true, onboarded: false });
    }

    const hasOrg = !!user.organizationId;
    const org = hasOrg
      ? await prisma.organization.findUnique({ where: { id: user.organizationId! } })
      : null;

    return NextResponse.json({
      needsAuth: false,
      onboarded: hasOrg,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      organization: org ? { id: org.id, name: org.name, currency: org.currency } : null,
    });
  } catch {
    return NextResponse.json({ needsAuth: true, onboarded: false });
  }
}

// POST: Complete onboarding — create org and link user
export async function POST(request: NextRequest) {
  try {
    const user = await getOrCreateSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawBody = await request.json();


    const parsed = OnboardingCompleteSchema.safeParse(rawBody);


    if (!parsed.success) {


      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });


    }


    const body = parsed.data;
    const {
      companyName,
      companyType = "LLP",
      gstin,
      pan,
      currency = "INR",
      fyStart = "april",
    } = body;

    if (!companyName?.trim()) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }

    // Create the organization
    const org = await prisma.organization.create({
      data: {
        name: companyName.trim(),
        currency,
        gstNumber: gstin || null,
        address: JSON.stringify({
          companyType,
          pan: pan || null,
          fyStart,
          onboardedAt: new Date().toISOString(),
        }),
      },
    });

    // Link user to org
    await prisma.user.update({
      where: { id: user.id },
      data: { organizationId: org.id },
    });

    return NextResponse.json({
      success: true,
      organization: { id: org.id, name: org.name, currency: org.currency },
    }, { status: 201 });
  } catch (error) {
    log.error("Onboarding error", { module: "onboarding", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to complete onboarding" }, { status: 500 });
  }
}
