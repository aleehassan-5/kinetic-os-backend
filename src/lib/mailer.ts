import nodemailer from "nodemailer";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export async function sendMail(input: { to: string; subject: string; html: string; text?: string }): Promise<{ sent: boolean }> {
  if (!env.SMTP_HOST) {
    logger.warn({ to: input.to, subject: input.subject }, "[mailer] no SMTP_HOST configured — logging instead of sending");
    return { sent: false };
  }

  try {
    await getTransporter().sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { sent: true };
  } catch (err) {
    logger.error({ err: (err as Error).message, to: input.to }, "[mailer] send failed");
    return { sent: false };
  }
}

export function inviteEmailTemplate(input: { workspaceName: string; inviterName: string; role: string; signupUrl: string }) {
  return {
    subject: `You've been invited to join ${input.workspaceName} on Kinetic OS`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>You're invited to Kinetic OS</h2>
        <p>${input.inviterName} invited you to join <strong>${input.workspaceName}</strong> as a <strong>${input.role.toLowerCase()}</strong>.</p>
        <p><a href="${input.signupUrl}" style="display:inline-block;padding:10px 18px;background:#7C5CFF;color:#fff;border-radius:6px;text-decoration:none;">Accept invite</a></p>
        <p style="color:#888;font-size:12px;">If you weren't expecting this, you can ignore this email.</p>
      </div>
    `,
    text: `${input.inviterName} invited you to join ${input.workspaceName} on Kinetic OS as a ${input.role.toLowerCase()}. Accept: ${input.signupUrl}`,
  };
}
