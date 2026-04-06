import nodemailer from "nodemailer";
import type { NotificationEmailSendArgs } from "../types/deps.js";

export async function sendNotificationEmailViaSmtp(
  args: NotificationEmailSendArgs,
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: args.smtpHost,
    port: args.smtpPort,
    secure: args.useSsl,
    auth:
      args.smtpUsername || args.smtpPassword
        ? {
            user: args.smtpUsername,
            pass: args.smtpPassword,
          }
        : undefined,
    requireTLS: args.useTls,
  });

  const from = args.fromName?.trim()
    ? `"${args.fromName.trim().replace(/"/g, '\\"')}" <${args.fromEmail}>`
    : args.fromEmail;

  await transporter.sendMail({
    from,
    to: args.to,
    subject: args.subject,
    text: args.text,
    ...(args.replyTo?.trim() ? { replyTo: args.replyTo.trim() } : {}),
  });
}
