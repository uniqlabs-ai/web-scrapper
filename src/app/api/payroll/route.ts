import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { calculateTDS } from "@/lib/tds";
import { createRazorpayContact, createFundAccount, executePayout } from "@/lib/payouts";
import { log, toLogError } from "@/lib/logger";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const PayrollActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_employee"),
    name: z.string().min(1).max(200),
    email: z.string().email().optional().or(z.literal("")),
    designation: z.string().max(100).optional(),
    department: z.string().max(100).optional(),
    basicSalary: z.coerce.number().min(0).default(0),
    hra: z.coerce.number().min(0).default(0),
    da: z.coerce.number().min(0).default(0),
    specialAllowance: z.coerce.number().min(0).default(0),
    ctc: z.coerce.number().min(0).optional(),
    type: z.enum(["employee", "contractor"]).default("employee"),
    paymentBasis: z.enum(["fixed", "milestone", "hourly"]).optional(),
  }),
  z.object({
    action: z.literal("run_payroll"),
    month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM"),
  }),
  z.object({
    action: z.literal("pay_payroll"),
    month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM"),
  }),
]);

/**
 * GET /api/payroll — List employees with salary info, or payroll runs for a month
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, organizationId } = await requireTenant();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "employees"; // employees | runs
    const month = searchParams.get("month");

    if (view === "runs" && month) {
      const runs = await prisma.payrollRun.findMany({
      take: 500,
        where: { userId, month },
        include: { employee: { select: { name: true, employeeId: true, designation: true } } },
        orderBy: { employee: { name: "asc" } },
      });

      const totalGross = runs.reduce((s, r) => s + Number(r.grossPay), 0);
      const totalDeductions = runs.reduce((s, r) => s + Number(r.totalDeductions), 0);
      const totalNet = runs.reduce((s, r) => s + Number(r.netPay), 0);
      const totalPfEmployer = runs.reduce((s, r) => s + Number(r.pfEmployer), 0);
      const totalEsiEmployer = runs.reduce((s, r) => s + Number(r.esiEmployer), 0);

      return NextResponse.json({
        month,
        runs: runs.map((r) => ({
          id: r.id,
          employeeId: r.employee.employeeId,
          name: r.employee.name,
          designation: r.employee.designation,
          status: r.status,
          grossPay: Number(r.grossPay),
          pfEmployee: Number(r.pfEmployee),
          esiEmployee: Number(r.esiEmployee),
          professionalTax: Number(r.professionalTax),
          tds: Number(r.tds),
          totalDeductions: Number(r.totalDeductions),
          netPay: Number(r.netPay),
        })),
        summary: { totalGross, totalDeductions, totalNet, totalPfEmployer, totalEsiEmployer, employeeCount: runs.length, companyCost: totalGross + totalPfEmployer + totalEsiEmployer },
      });
    }

    // List employees
    const employees = await prisma.employee.findMany({
      take: 500,
      where: { userId, isActive: true },
      orderBy: { name: "asc" },
    });

    // Build a set of all alias names (lowercased) across employees
    // so we can filter out employees whose name IS an alias of another employee
    const aliasToOwnerId = new Map<string, string>(); // alias (lower) -> owner employee id
    for (const emp of employees) {
      try {
        const parsed = JSON.parse(emp.aliases || "[]");
        if (Array.isArray(parsed)) {
          for (const alias of parsed) {
            aliasToOwnerId.set(String(alias).toLowerCase(), emp.id);
          }
        }
      } catch (e: unknown) {
        // RELIABILITY: Log malformed alias JSON
        log.warn("Malformed aliases JSON", { module: "payroll", action: "list", meta: { employeeId: emp.id, error: e instanceof Error ? e.message : String(e) } });
      }
    }

    // Filter: hide employees whose name matches an alias of a DIFFERENT employee
    const filtered = employees.filter(emp => {
      const owner = aliasToOwnerId.get(emp.name.toLowerCase());
      // Keep if no alias match, or if this employee IS the alias owner
      return !owner || owner === emp.id;
    });

    return NextResponse.json({
      employees: filtered.map((e) => ({
        id: e.id,
        employeeId: e.employeeId,
        name: e.name,
        email: e.email,
        designation: e.designation,
        department: e.department,
        basicSalary: Number(e.basicSalary),
        hra: Number(e.hra),
        ctc: Number(e.ctc),
        isActive: e.isActive,
        type: e.type,
        paymentBasis: e.paymentBasis,
        joinDate: e.joinDate.toISOString(),
      })),
    });
  } catch (error) {
    log.error("Payroll list failed", { module: "payroll", action: "list", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/**
 * POST /api/payroll — Add employee or run payroll
 */
export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, { windowSec: 60, max: 10, prefix: "payroll" });
    if (limited) return limited;
    const { userId, organizationId } = await requireTenant();
    const rawBody = await request.json();
    const parsed = PayrollActionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
    }
    const body = parsed.data;
    const { action } = body;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });

    if (action === "add_employee") {
      const { name, email, designation, department, basicSalary, hra, da, specialAllowance, ctc, type, paymentBasis } = body;
      const count = await prisma.employee.count({ where: { userId } });
      const prefix = (type === "contractor") ? "CON" : "EMP";
      const employee = await prisma.employee.create({
        data: {
          employeeId: `${prefix}-${String(count + 1).padStart(3, "0")}`,
          name, email, designation, department,
          basicSalary: basicSalary || 0,
          hra: hra || 0,
          da: da || 0,
          specialAllowance: specialAllowance || 0,
          ctc: ctc || (basicSalary || 0) * 12,
          type: type || "employee",
          paymentBasis: paymentBasis || null,
          userId,
          organizationId: user?.organizationId,
        },
      });
      logAudit({ userId, action: "create", resource: "employee", resourceId: employee.id, details: { name, type: type || "employee", basicSalary } });
      return NextResponse.json(employee, { status: 201 });
    }

    if (action === "run_payroll") {
      const { month } = body;
      if (!month) return NextResponse.json({ error: "Month required" }, { status: 400 });

      // Check if already run
      const existing = await prisma.payrollRun.findFirst({ where: { userId, month } });
      if (existing) return NextResponse.json({ error: "Payroll already run for this month" }, { status: 409 });

      const employees = await prisma.employee.findMany({ where: { userId, isActive: true }, take: 200 });
      const runs = [];

      for (const emp of employees) {
        const basic = Number(emp.basicSalary);
        const hraVal = Number(emp.hra);
        const daVal = Number(emp.da);
        const special = Number(emp.specialAllowance);
        const other = Number(emp.otherAllowance);
        const gross = basic + hraVal + daVal + special + other;

        let pfEmployee = 0, pfEmployer = 0, esiEmployee = 0, esiEmployer = 0, professionalTax = 0, tds = 0;

        if (emp.type === "contractor") {
          // Contractors don't get PF/ESI. They only get TDS deducted (e.g. 194J at 10% or 194C at 1%).
          const isProfessional = emp.paymentBasis === "hourly" || emp.designation?.toLowerCase().includes("engineer") || emp.designation?.toLowerCase().includes("consultant");
          const section = isProfessional ? "194J(b)" : "194C";
          // PAN presence assumption is true for this simplified engine.
          const tdsCalc = calculateTDS(gross, section, true);
          tds = tdsCalc.tdsAmount;
        } else {
          // Employee Statutory deductions
          pfEmployee = Math.min(Math.round(basic * 0.12), 1800); // 12% of basic, max ₹1800/mo on 15000 ceiling
          pfEmployer = pfEmployee;
          esiEmployee = gross <= 21000 ? Math.round(gross * 0.0075) : 0;
          esiEmployer = gross <= 21000 ? Math.round(gross * 0.0325) : 0;
          professionalTax = gross > 15000 ? 200 : gross > 10000 ? 150 : 0; // Karnataka rates
          tds = Math.round(basic * 0.1); // Simplified: 10% of basic as monthly TDS estimate
        }

        const totalDeductions = pfEmployee + esiEmployee + professionalTax + tds;
        const netPay = gross - totalDeductions;

        const run = await prisma.payrollRun.create({
          data: {
            month,
            status: "processed",
            employeeId: emp.id,
            basicPay: basic,
            hraPay: hraVal,
            daPay: daVal,
            specialPay: special,
            otherPay: other,
            grossPay: gross,
            pfEmployee, pfEmployer,
            esiEmployee, esiEmployer,
            professionalTax, tds,
            otherDeductions: 0,
            totalDeductions,
            netPay,
            userId,
            organizationId: user?.organizationId,
          },
        });
        runs.push(run);
      }

      logAudit({ userId, action: "process", resource: "payroll-run", details: { month, employeeCount: runs.length } });
      return NextResponse.json({ processed: runs.length, month }, { status: 201 });
    }

    if (action === "pay_payroll") {
      const { month } = body;
      if (!month) return NextResponse.json({ error: "Month required" }, { status: 400 });

      // Find unprocessed runs
      const runs = await prisma.payrollRun.findMany({
      take: 500, 
        where: { userId, month, status: "processed" },
        include: { employee: true },
      });
      if (runs.length === 0) return NextResponse.json({ error: "No processed payroll available to pay" }, { status: 400 });

      // Ensure user has a bank account to deduct from
      const bankAccount = await prisma.bankAccount.findFirst({
        where: { userId, isActive: true },
        orderBy: { currentBalance: "desc" }
      });

      if (!bankAccount) return NextResponse.json({ error: "No active bank account to route payroll from" }, { status: 400 });

      const txns = [];
      const now = new Date();
      let totalDeducted = 0;

      for (const run of runs) {
        const netPayNum = Number(run.netPay);
        totalDeducted += netPayNum;

        // Native Payout Engine
        const rzpContactId = await createRazorpayContact({
           name: run.employee.name,
           type: run.employee.type === "contractor" ? "vendor" : "employee",
           reference_id: `emp_${run.employee.id}`
        });

        const rzpFundAccountId = await createFundAccount({
           contact_id: rzpContactId,
           bank_name: "Mapped Employee Bank", // Fallback for schema
           account_number: run.employee.bankAccount || "000000000",
           ifsc: run.employee.bankIfsc || "HDFC0001234"
        });

        const payoutId = await executePayout({
           fund_account_id: rzpFundAccountId,
           amount: netPayNum,
           currency: "INR",
           mode: "IMPS",
           purpose: "salary",
           source_bank_id: bankAccount.id
        });

        // Create transaction payload
        const txn = {
          date: now,
          description: `Direct Deposit: ${run.employee.name} (${month})`,
          amount: netPayNum,
          type: "debit",
          category: run.employee.type === "contractor" ? "Contractor Fees" : "Payroll",
          vendor: run.employee.name,
          source: "payroll",
          reference: payoutId, // Log real RazorpayX Payment Reference
          isReconciled: true,
          bankAccountId: bankAccount.id,
          userId,
        };
        txns.push(txn);
      }

      // Execute in transaction
      await prisma.$transaction([
        prisma.bankTransaction.createMany({ data: txns }),
        prisma.bankAccount.update({
          where: { id: bankAccount.id },
          data: { currentBalance: { decrement: totalDeducted } }
        }),
        prisma.payrollRun.updateMany({
          where: { userId, month, status: "processed" },
          data: { status: "paid", updatedAt: now }
        })
      ]);

      logAudit({ userId, action: "process", resource: "payroll", details: { month, paidCount: runs.length, totalDeducted } });
      return NextResponse.json({ paid: runs.length, month, totalDeducted }, { status: 200 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    log.error("Payroll operation failed", { module: "payroll", action: "process", error: toLogError(error) });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
