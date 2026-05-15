import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { requirePermission } from "@/lib/guards";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const TransferSchema = z.object({
  sourceType: z.enum(["payroll", "recurring"]),
  sourceId: z.string().min(1, "sourceId required"),
  targetType: z.enum(["payroll", "recurring"]),
});

/**
 * POST /api/transfer
 * Body: { sourceType: "payroll" | "recurring", sourceId: string, targetType: "payroll" | "recurring" }
 *
 * Transfers an item from payroll → recurring or recurring → payroll.
 * Creates a new record in the target table and deletes the source.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 5, prefix: "transfer" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const guard = await requirePermission("write");
    if (!guard.allowed) return guard.response;
    const rawBody = await request.json();
    const parsed = TransferSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const { sourceType, sourceId, targetType } = parsed.data;

    if (sourceType === targetType) {
      return NextResponse.json({ error: "Source and target types must be different" }, { status: 400 });
    }

    // Get user's org
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });

    let newId: string;

    if (sourceType === "payroll" && targetType === "recurring") {
      // ── Payroll → Recurring ──
      const employee = await prisma.employee.findFirst({
        where: { id: sourceId, userId, organizationId },
      });
      if (!employee) {
        return NextResponse.json({ error: "Employee not found" }, { status: 404 });
      }

      const recurring = await prisma.recurringExpense.create({
        data: {
          description: employee.name,
          amount: employee.basicSalary,
          currency: "INR",
          frequency: "monthly",
          startDate: employee.joinDate,
          nextDueDate: new Date(),
          isActive: employee.isActive,
          vendor: employee.name,
          notes: `Transferred from Payroll. Original Employee ID: ${employee.employeeId}. ${employee.designation ? `Role: ${employee.designation}.` : ""} ${(employee as Record<string, unknown>).type === "contractor" ? "Was a contractor." : ""}`,
          aliases: (employee as Record<string, unknown>).aliases as string | undefined,
          userId,
          organizationId: user?.organizationId,
        },
      });

      // Delete the payroll entry
      await prisma.employee.delete({ where: { id: sourceId } });

      newId = recurring.id;

      logAudit({
        userId,
        action: "process",
        resource: "employee",
        resourceId: sourceId,
        details: {
          action: "transfer_to_recurring",
          employeeName: employee.name,
          newRecurringId: recurring.id,
        },
      });
    } else if (sourceType === "recurring" && targetType === "payroll") {
      // ── Recurring → Payroll ──
      const recurring = await prisma.recurringExpense.findFirst({
        where: { id: sourceId, userId, organizationId },
      });
      if (!recurring) {
        return NextResponse.json({ error: "Recurring expense not found" }, { status: 404 });
      }

      // Generate next employee ID
      const empCount = await prisma.employee.count({ where: { userId, organizationId } });
      const employeeId = `EMP-${String(empCount + 1).padStart(3, "0")}`;

      const employee = await prisma.employee.create({
        data: {
          employeeId,
          name: recurring.description,
          isActive: recurring.isActive,
          type: "contractor", // default to contractor since this was a recurring expense
          paymentBasis: "fixed",
          basicSalary: recurring.amount,
          hra: 0,
          da: 0,
          specialAllowance: 0,
          otherAllowance: 0,
          ctc: Number(recurring.amount) * 12, // annualize the monthly amount
          joinDate: recurring.startDate,
          aliases: (recurring as Record<string, unknown>).aliases as string | undefined,
          userId,
          organizationId: user?.organizationId,
        },
      });

      // Delete the recurring entry
      await prisma.recurringExpense.delete({ where: { id: sourceId } });

      newId = employee.id;

      logAudit({
        userId,
        action: "process",
        resource: "recurring",
        resourceId: sourceId,
        details: {
          action: "transfer_to_payroll",
          recurringDesc: recurring.description,
          newEmployeeId: employee.id,
        },
      });
    } else {
      return NextResponse.json({ error: "Invalid transfer direction" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      newId,
      message: `Successfully transferred from ${sourceType} to ${targetType}`,
    });
  } catch (error) {
    log.error("Transfer error", { module: "transfer", action: "handler", error: toLogError(error) });
    return NextResponse.json({ error: "Transfer failed" }, { status: 500 });
  }
}
