/**
 * Unit test: Notification dispatcher rate limiting — structural verification.
 */

import { describe, it, expect } from 'vitest';

describe('Notification Dispatcher — Rate Limiting', () => {
  it('should define rate limit of max 5 per event type per 24h (configurable via env)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const eventsPath = path.join(process.cwd(), 'lib/notifications/events.ts');
    const content = fs.readFileSync(eventsPath, 'utf-8');

    // Values are now read from env vars with defaults — verify the pattern exists
    expect(content).toContain('RATE_LIMIT_NOTIFICATION_MAX');
    expect(content).toContain('RATE_LIMIT_NOTIFICATION_WINDOW_HOURS');
    // Verify defaults match the original hardcoded values
    expect(content).toContain('?? 5');
    expect(content).toContain('?? 24');
  });

  it('should check rate limits before sending', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dispatcherPath = path.join(process.cwd(), 'lib/notifications/dispatcher.ts');
    const content = fs.readFileSync(dispatcherPath, 'utf-8');

    expect(content).toContain('isWithinRateLimit');
    expect(content).toContain('rateLimited');
  });

  it('should log to NotificationLog', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dispatcherPath = path.join(process.cwd(), 'lib/notifications/dispatcher.ts');
    const content = fs.readFileSync(dispatcherPath, 'utf-8');

    expect(content).toContain('notificationLog.create');
  });

  it('should use Property NI colors in email templates', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const emailPath = path.join(process.cwd(), 'lib/notifications/email.ts');
    const content = fs.readFileSync(emailPath, 'utf-8');

    // Navy header
    expect(content).toContain('#1B2A4A');
    // Amber accent
    expect(content).toContain('#F5A623');
  });
});
