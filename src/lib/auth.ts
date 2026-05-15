import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "./prisma";

export async function getSessionUser() {
  const session = await getServerSession(authOptions);

  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { organization: true },
    });
    return user;
  }

  // Dev mode: check for existing dev user (read-only, no auto-create)
  if (process.env.NODE_ENV === "development") {
    const devUser = await prisma.user.findUnique({
      where: { email: "dev@founderos.local" },
      include: { organization: true },
    });
    return devUser;
  }

  return null;
}

export async function getOrCreateSessionUser() {
  const session = await getServerSession(authOptions);

  if (session?.user?.email) {
    let user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: { organization: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: session.user.email,
          fullName: session.user.name || undefined,
          avatarUrl: session.user.image || undefined,
        },
        include: { organization: true },
      });
    }

    return user;
  }

  // Dev mode: auto-create/find a local dev user for onboarding
  if (process.env.NODE_ENV === "development") {
    const devEmail = "dev@founderos.local";
    let user = await prisma.user.findUnique({
      where: { email: devEmail },
      include: { organization: true },
    });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: devEmail,
          fullName: "Local Developer",
        },
        include: { organization: true },
      });
    }
    return user;
  }

  return null;
}

export async function requireUser() {
  const user = await getOrCreateSessionUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

export async function getAuthUserId(): Promise<string> {
  const user = await getOrCreateSessionUser();
  if (user) return user.id;
  throw new Error("Unauthorized");
}

export function getUserId(user: { id: string }) {
  return user.id;
}
