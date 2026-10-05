/**
 * Email sending function for the notification system.
 *
 * Uses nodemailer to send branded email notifications with Property NI colors.
 */

import { createTransport, type Transporter } from 'nodemailer';
import { env } from '@/lib/env';

/**
 * Email template with Property NI branding.
 */
function createEmailTemplate(
  subject: string,
  message: string,
  headerTitle = 'Property NI — Security Alert'
): { html: string; text: string } {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8f9fa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto;">
    <!-- Header: Property NI Navy -->
    <tr>
      <td style="background-color: #1B2A4A; padding: 24px 32px;">
        <h1 style="margin: 0; color: #ffffff; font-size: 20px;">${headerTitle}</h1>
      </td>
    </tr>
    <!-- Body -->
    <tr>
      <td style="padding: 32px; background-color: #ffffff;">
        <p style="color: #1e3a5f; font-size: 16px; line-height: 1.6;">${message}</p>
        <!-- Amber accent bar -->
        <div style="height: 4px; background-color: #F5A623; margin-top: 24px;"></div>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="background-color: #f8f9fa; padding: 16px 32px; text-align: center;">
        <p style="color: #6c757d; font-size: 12px; margin: 0;">
          This is an automated notification from Property NI. Do not reply.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${subject}\n\n${message}\n\n---\nThis is an automated notification from Property NI.`;

  return { html, text };
}

/**
 * Send an email notification.
 */
export async function sendEmail(
  to: string,
  subject: string,
  message: string,
  headerTitle?: string
): Promise<{ success: boolean; error?: string }> {
  const smtpHost = env.SMTP_HOST;
  const smtpPort = env.SMTP_PORT;
  const smtpUser = env.SMTP_USER || '';
  const smtpPass = env.SMTP_PASS || '';
  const smtpFrom = env.SMTP_FROM;

  const template = createEmailTemplate(subject, message, headerTitle);

  let transporter: Transporter;

  if (smtpUser && smtpPass) {
    transporter = createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });
  } else {
    // Development mode: no auth
    transporter = createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
    });
  }

  try {
    await transporter.sendMail({
      from: smtpFrom,
      to,
      subject,
      html: template.html,
      text: template.text,
    });

    return { success: true };
  } catch (error) {
    console.error('[Email] Failed to send:', error);
    return { success: false, error: (error as Error).message };
  }
}
