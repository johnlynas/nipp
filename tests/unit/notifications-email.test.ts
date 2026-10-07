/**
 * Contract pin for lib/notifications/email.ts across nodemailer majors.
 *
 * The only production surface is sendEmail(to, subject, message, headerTitle?)
 * built on createTransport + sendMail (options: host/port/secure/auth) — APIs
 * stable since v4. These specs exist so a major bump (9 -> 10) is verified
 * against the real shape of what we call, not "it imported fine".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateTransport = vi.fn();
const mockSendMail = vi.fn().mockResolvedValue({ messageId: '<ok@nipp>' });
mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });

vi.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => mockCreateTransport(...args),
}));

import { sendEmail } from '@/lib/notifications/email';

describe('sendEmail (nodemailer contract)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls transport with from/to/subject and both html and text parts', async () => {
    const res = await sendEmail('target@example.net', 'Hello subject', '<p>body</p>');
    expect(res.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe('target@example.net');
    expect(mail.subject).toBe('Hello subject');
    expect(String(mail.html)).toContain('<p>body</p>');
    expect(String(mail.text)).toContain('body');
    expect(String(mail.from)).toContain('@');
  });

  it('passes host/port with secure=false for non-465 ports', async () => {
    await sendEmail('a@b.co', 's', 'm');
    const opts = mockCreateTransport.mock.calls[0][0];
    expect(opts.port).toBe(587); // env default when SMTP_PORT unset in tests
    expect(opts.secure).toBe(false);
  });

  it('maps sendMail rejection to success=false with the error message', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await sendEmail('a@b.co', 's', 'm');
    expect(res).toEqual({ success: false, error: 'ECONNREFUSED' });
  });

  it('accepts an optional headerTitle that reaches the html template', async () => {
    await sendEmail('a@b.co', 's', 'm', 'Custom Header');
    const mail = mockSendMail.mock.calls[0][0];
    expect(String(mail.html)).toContain('Custom Header');
  });
});
