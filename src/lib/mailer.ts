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

export function resetPasswordEmailTemplate(input: { name: string; resetUrl: string }) {
  return {
    subject: "Reset your Kinetic OS password",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Reset your password</h2>
        <p>Hi ${input.name}, we received a request to reset your Kinetic OS password.</p>
        <p><a href="${input.resetUrl}" style="display:inline-block;padding:10px 18px;background:#7C5CFF;color:#fff;border-radius:6px;text-decoration:none;">Reset password</a></p>
        <p style="color:#888;font-size:12px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
      </div>
    `,
    text: `Reset your Kinetic OS password: ${input.resetUrl} (expires in 1 hour). If you didn't request this, ignore this email.`,
  };
}

export function accountApprovedEmailTemplate(input: { name: string; businessName: string; loginUrl: string }) {
  return {
    subject: "You're approved — welcome to Kinetic OS!",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Welcome aboard, ${input.name}!</h2>
        <p><strong>${input.businessName}</strong> has been approved on Kinetic OS. Your workspace is ready.</p>
        <p><a href="${input.loginUrl}" style="display:inline-block;padding:10px 18px;background:#7C5CFF;color:#fff;border-radius:6px;text-decoration:none;">Log in and get started</a></p>
        <p style="color:#888;font-size:12px;">Next up: connect a channel (WhatsApp, email, or social) and add a few documents to your knowledge base.</p>
      </div>
    `,
    text: `Welcome, ${input.name}! ${input.businessName} has been approved on Kinetic OS. Log in: ${input.loginUrl}`,
  };
}

export function accountRejectedEmailTemplate(input: { name: string; businessName: string; reason?: string }) {
  return {
    subject: "About your Kinetic OS application",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Update on your application</h2>
        <p>Hi ${input.name}, we weren't able to approve <strong>${input.businessName}</strong>'s application to Kinetic OS at this time.</p>
        ${input.reason ? `<p><strong>Reason:</strong> ${input.reason}</p>` : ""}
        <p style="color:#888;font-size:12px;">If you think this was a mistake, reply to this email and we'll take another look.</p>
      </div>
    `,
    text: `Hi ${input.name}, we weren't able to approve ${input.businessName}'s application.${input.reason ? ` Reason: ${input.reason}` : ""}`,
  };
}

export function accountSuspendedEmailTemplate(input: { name: string; businessName: string }) {
  return {
    subject: "Your Kinetic OS account has been suspended",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Account suspended</h2>
        <p>Hi ${input.name}, access to <strong>${input.businessName}</strong>'s Kinetic OS workspace has been suspended. Your data is safe and untouched.</p>
        <p style="color:#888;font-size:12px;">Contact support if you believe this is a mistake.</p>
      </div>
    `,
    text: `Hi ${input.name}, access to ${input.businessName}'s Kinetic OS workspace has been suspended. Your data is safe and untouched.`,
  };
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
