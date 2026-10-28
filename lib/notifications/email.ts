/**
 * Email sending function for the notification system.
 *
 * Uses nodemailer to send branded email notifications with Property NI colors.
 */

import { createTransport, type Transporter } from 'nodemailer';
import { env } from '@/lib/env';

/** Escapes plain text for safe HTML interpolation. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Authored HTML (e.g. the OIDC invitation with a styled button) must pass through untouched. Deliberately strict — < + tag letter + whitespace/> only, so field values like `A & B <Ltd>` cannot be mistaken for markup and escape the escaping path. */
const HAS_HTML_TAG = /<\/?[A-Za-z][\s>]/;

/**
 * Render a message body for the branded template.
 * - Authored HTML passes through verbatim (the OIDC invite owns its own markup,
 *   buttons and all).
 * - Plain text is escaped and laid out as real paragraphs: blank-line blocks
 *   become &lt;p&gt;, single line breaks inside a block become &lt;br&gt;.
 *   Without this, every \n collapses in HTML and multi-line bodies ship as one
 *   run-on paragraph (the work order RFQ wall-of-text bug).
 */
export function renderBodyForTemplate(message: string): string {
  if (HAS_HTML_TAG.test(message)) return message;
  const paragraphs = escapeHtml(message.trim())
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, '<br>'))
    .map((p) => `<p style="margin: 0 0 16px; color: #1e3a5f; font-size: 16px; line-height: 1.6;">${p}</p>`)
    .join('');
  return paragraphs;
}

/**
 * Email template with Property NI branding.
 */
export function createEmailTemplate(
  subject: string,
  message: string,
  headerTitle = 'Property NI — Security Alert'
): { html: string; text: string } {
  const bodyCell = renderBodyForTemplate(message);
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
        ${bodyCell}
        <!-- Amber accent bar -->
        <div style="height: 4px; background-color: #F5A623; margin-top: 24px;"></div>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="background-color: #f8f9fa; padding: 16px 32px; text-align: center;">
        <p style="color: #6c757d; font-size: 12px; margin: 0;">
          This is an automated notification from Property NI
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
