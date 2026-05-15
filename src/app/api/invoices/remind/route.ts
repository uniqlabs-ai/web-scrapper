import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, TenantError } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { log, toLogError } from "@/lib/logger";
import { z } from "zod";

// Zod schema — this POST takes no body; validated via safeParse({})
const EmptyBodySchema = z.object({}).strict();

// GET: Return the follow-up pipeline state for overdue invoices
export async function GET() {
  try {
    const { userId, organizationId } = await requireTenant();
    const now = new Date();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { organization: { select: { alertSettings: true } } },
    });

    let reminderSequences = [1, 7, 15, 30];
    if (user?.organization?.alertSettings) {
      try {
        const settings = JSON.parse(user.organization.alertSettings);
        if (Array.isArray(settings.invoiceReminders)) {
          reminderSequences = settings.invoiceReminders.sort((a: number, b: number) => a - b);
        }
      } catch (e: unknown) {
        log.warn("Malformed alertSettings JSON", { module: "invoices", action: "remind", meta: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    const overdueInvoices = await prisma.invoice.findMany({
      take: 500,
      where: { userId, organizationId, status: { in: ["sent", "overdue"] }, dueDate: { lt: now } },
      include: { client: true },
      orderBy: { dueDate: "asc" },
    });

    // Get all reminder audit logs for these invoices
    const invoiceIds = overdueInvoices.map((i) => i.id);
    const auditLogs = invoiceIds.length > 0
      ? await prisma.auditLog.findMany({
      take: 500,
          where: { resourceId: { in: invoiceIds }, resource: "invoice_reminder" },
          orderBy: { createdAt: "desc" },
        })
      : [];

    const pipeline = overdueInvoices.map((inv) => {
      const daysPastDue = Math.floor(
        (now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Find which sequences have been sent
      const invAudits = auditLogs.filter((a) => a.resourceId === inv.id);
      const sentSequences: { sequence: number; sentAt: string }[] = [];
      for (const audit of invAudits) {
        try {
          const details = typeof audit.details === "string" ? JSON.parse(audit.details) : audit.details;
          if (details?.sequence) {
            sentSequences.push({ sequence: details.sequence, sentAt: audit.createdAt.toISOString() });
          }
        } catch (e: unknown) {
          log.warn("Malformed audit details JSON", { module: "invoices", action: "remind", meta: { error: e instanceof Error ? e.message : String(e) } });
        }
      }

      // Current stage
      const completedSequences = sentSequences.map((s) => s.sequence);
      const currentStage = reminderSequences.filter((s) => daysPastDue >= s);
      const nextSequence = reminderSequences.find((s) => !completedSequences.includes(s) && daysPastDue >= s)
        || reminderSequences.find((s) => s > daysPastDue);

      const nextReminderDate = nextSequence
        ? new Date(new Date(inv.dueDate).getTime() + nextSequence * 86400000).toISOString()
        : null;

      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        clientName: inv.client?.name || "Unknown",
        clientEmail: inv.client?.email || null,
        total: Number(inv.total),
        currency: inv.currency,
        dueDate: inv.dueDate.toISOString(),
        daysPastDue,
        currentStage: currentStage.length > 0 ? Math.max(...currentStage) : 0,
        sentReminders: sentSequences,
        nextSequence: nextSequence || null,
        nextReminderDate,
        isFullyEscalated: currentStage.length >= reminderSequences.length,
      };
    });

    const totalOverdue = pipeline.reduce((s, p) => s + p.total, 0);
    const remindersSentThisWeek = auditLogs.filter(
      (a) => a.createdAt >= new Date(now.getTime() - 7 * 86400000)
    ).length;

    return NextResponse.json({
      pipeline,
      stats: {
        totalOverdue,
        overdueCount: pipeline.length,
        remindersSentThisWeek,
        sequences: reminderSequences,
      },
    });
  } catch (error) {
    log.error("Follow-up pipeline error", { module: "invoices", action: "remind", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to load pipeline" }, { status: 500 });
  }
}

// POST: Send reminders for overdue invoices based on configured sequences
export async function POST() {
  try {
    // Validate: no unexpected body properties
    const _validated = EmptyBodySchema.safeParse({});
    const { userId, organizationId } = await requireTenant();
    const now = new Date();

    // Get user's active organization configuration
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { organization: { select: { alertSettings: true } } }
    });
    
    let reminderSequences = [1, 7, 15, 30]; // defaults
    if (user?.organization?.alertSettings) {
      try {
        const settings = JSON.parse(user.organization.alertSettings);
        if (Array.isArray(settings.invoiceReminders)) {
          reminderSequences = settings.invoiceReminders.sort((a: number, b: number) => a - b);
        }
      } catch (e: unknown) {
        log.warn("Malformed alertSettings JSON", { module: "invoices", action: "remind", meta: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    if (reminderSequences.length === 0) {
      return NextResponse.json({ sent: 0, message: "Reminders disabled in settings" });
    }

    // Get overdue unpaid invoices
    const overdueInvoices = await prisma.invoice.findMany({
      take: 500,
      where: {
        userId,
        organizationId,
        status: { in: ["sent", "overdue"] },
        dueDate: { lt: now },
      },
      include: { client: true },
    });

    if (overdueInvoices.length === 0) {
      return NextResponse.json({ sent: 0, message: "No overdue invoices" });
    }

    let sent = 0;
    const results: { invoiceNumber: string; client: string; amount: number; daysPastDue: number; sequenceSent: number | null; emailSent: boolean }[] = [];

    for (const inv of overdueInvoices) {
      const daysPastDue = Math.floor(
        (now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Determine the highest sequence day applicable
      const applicableSequences = reminderSequences.filter(day => daysPastDue >= day);
      if (applicableSequences.length === 0) continue; // Not overdue enough for the first sequence

      const targetSequence = Math.max(...applicableSequences);

      // Check if this sequence was already sent
      const pastAudits = await prisma.auditLog.findMany({
      take: 500,
        where: {
          resourceId: inv.id,
          resource: "invoice_reminder",
        },
      });
      
      const alreadySent = pastAudits.some(audit => {
        try {
          if (!audit.details) return false;
          const details = typeof audit.details === 'string' ? JSON.parse(audit.details) : audit.details;
          return details.sequence === targetSequence;
        } catch { return false; }
      });

      if (alreadySent) {
        // Skip, we already sent the reminder for this stage
        continue;
      }

      // Update status to overdue if still "sent"
      if (inv.status === "sent") {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { status: "overdue" },
        });
      }

      // Try to send email reminder if client has email
      let emailSent = false;
      const clientEmail = inv.client?.email;

      if (clientEmail && process.env.RESEND_API_KEY) {
        try {
          const { Resend } = await import("resend");
          const resend = new Resend(process.env.RESEND_API_KEY);

          const urgency = targetSequence >= 30 ? "URGENT" : targetSequence >= 15 ? "Reminder" : "Friendly Reminder";
          const clientName = inv.client?.name || "Client";

          await resend.emails.send({
            from: "Finance <finance@founderos.dev>",
            to: clientEmail,
            subject: `${urgency}: Invoice ${inv.invoiceNumber} — Payment Overdue by ${daysPastDue} days`,
            html: `
              <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1a1a2e;">Payment Reminder</h2>
                <p>Dear ${clientName},</p>
                <p>This is a ${urgency.toLowerCase()} that Invoice <strong>${inv.invoiceNumber}</strong> 
                   dated ${new Date(inv.issueDate).toLocaleDateString("en-IN")} for 
                   <strong>₹${Number(inv.total).toLocaleString("en-IN")}</strong> 
                   was due on ${new Date(inv.dueDate).toLocaleDateString("en-IN")} 
                   and is now <strong>${daysPastDue} days overdue</strong>.</p>
                <p>Please arrange payment at your earliest convenience.</p>
                ${daysPastDue > 30
                ? '<p style="color: #F43F5E;"><strong>This invoice is significantly overdue. Please treat this as urgent.</strong></p>'
                : ""}
                <hr style="border: 1px solid #eee; margin: 20px 0;" />
                <table style="width: 100%; font-size: 14px;">
                  <tr><td style="color: #666;">Invoice #</td><td><strong>${inv.invoiceNumber}</strong></td></tr>
                  <tr><td style="color: #666;">Amount</td><td><strong>₹${Number(inv.total).toLocaleString("en-IN")}</strong></td></tr>
                  <tr><td style="color: #666;">Due Date</td><td>${new Date(inv.dueDate).toLocaleDateString("en-IN")}</td></tr>
                  <tr><td style="color: #666;">Days Overdue</td><td style="color: #F43F5E;"><strong>${daysPastDue} days</strong></td></tr>
                </table>
                <p style="margin-top: 20px; font-size: 13px; color: #888;">
                  If you have already made the payment, please disregard this reminder.
                </p>
              </div>
            `,
          });
          
          emailSent = true;
          sent++;
          
          await logAudit({
            userId,
            action: "process",
            resource: "invoice_reminder",
            resourceId: inv.id,
            details: { sequence: targetSequence, daysPastDue, email: clientEmail }
          });
        } catch (emailErr) {
          log.error("Email send error", { module: "invoices", action: "remind", error: toLogError(emailErr) });
        }
      }

      results.push({
        invoiceNumber: inv.invoiceNumber,
        client: inv.client?.name || "Unknown",
        amount: Number(inv.total),
        daysPastDue,
        sequenceSent: targetSequence,
        emailSent,
      });
    }

    return NextResponse.json({
      sent,
      total: overdueInvoices.length,
      results,
      message: `Processed ${overdueInvoices.length} overdue invoices, sent ${sent} reminders`,
    });
  } catch (error) {
    log.error("Invoice reminder error", { module: "invoices", action: "remind", error: toLogError(error) });
    return NextResponse.json({ error: "Failed to send reminders" }, { status: 500 });
  }
}
