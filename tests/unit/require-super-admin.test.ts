import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { auth } from '@/lib/auth';
import { headers as nextHeaders } from 'next/headers';
import { verifySuperAdmin } from '@/lib/authz';
import { logger } from '@/lib/logger';

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

vi.mock('@/lib/authz', () => ({
  verifySuperAdmin: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('requireSuperAdmin', () => {
  const mockHeaders = new Headers({ 'x-test': '1' });
  const mockNextHeaders = new Headers({ 'x-next': '1' });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(nextHeaders).mockResolvedValue(mockNextHeaders as any);
  });

  describe('when no session is found', () => {
    it('should return 401 Unauthorized and log a warning', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null as any);

      const result = await requireSuperAdmin(mockHeaders);

      expect(auth.api.getSession).toHaveBeenCalledWith({ headers: mockHeaders });
      expect(result).toEqual({
        session: null,
        authorized: false,
        error: 'Unauthorized',
        status: 401,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { route: 'requireSuperAdmin' },
        'No session found'
      );
    });
  });

  describe('when session exists and user is verified super admin', () => {
    it('should return 200 authorized', async () => {
      const session = { user: { id: 'admin-user-id' }, session: { id: 'session-id' } } as any;
      vi.mocked(auth.api.getSession).mockResolvedValue(session);
      vi.mocked(verifySuperAdmin).mockResolvedValue({ authorized: true, error: undefined });

      const result = await requireSuperAdmin(mockHeaders);

      expect(verifySuperAdmin).toHaveBeenCalledWith('admin-user-id', undefined);
      expect(result).toEqual({
        session,
        authorized: true,
        status: 200,
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('when session exists but user is not super admin', () => {
    it('should return 403 Forbidden with the specific error message', async () => {
      const session = { user: { id: 'regular-user-id' }, session: { id: 'session-id' } } as any;
      vi.mocked(auth.api.getSession).mockResolvedValue(session);
      vi.mocked(verifySuperAdmin).mockResolvedValue({
        authorized: false,
        error: 'User is not a member of the platform organization',
      });

      const result = await requireSuperAdmin(mockHeaders);

      expect(result).toEqual({
        session,
        authorized: false,
        error: 'User is not a member of the platform organization',
        status: 403,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        {
          userId: 'regular-user-id',
          error: 'User is not a member of the platform organization',
          status: 403,
        },
        'Super admin verification failed'
      );
    });

    it('should return 403 with default error message when verifySuperAdmin returns no error', async () => {
      const session = { user: { id: 'regular-user-id' }, session: { id: 'session-id' } } as any;
      vi.mocked(auth.api.getSession).mockResolvedValue(session);
      vi.mocked(verifySuperAdmin).mockResolvedValue({
        authorized: false,
        error: undefined,
      });

      const result = await requireSuperAdmin(mockHeaders);

      expect(result).toEqual({
        session,
        authorized: false,
        error: 'Super Admin access required',
        status: 403,
      });
    });
  });

  describe('database/infrastructure errors', () => {
    it('should return 503 Service Unavailable when Database unavailable', async () => {
      const session = { user: { id: 'user-id' } } as any;
      vi.mocked(auth.api.getSession).mockResolvedValue(session);
      vi.mocked(verifySuperAdmin).mockResolvedValue({
        authorized: false,
        error: 'Database unavailable',
      });

      const result = await requireSuperAdmin(mockHeaders);

      expect(result.status).toBe(503);
      expect(result.error).toBe('Database unavailable');
      expect(logger.warn).toHaveBeenCalledWith(
        {
          userId: 'user-id',
          error: 'Database unavailable',
          status: 503,
        },
        'Super admin verification failed'
      );
    });

    it('should return 503 Service Unavailable when Platform organization not found', async () => {
      const session = { user: { id: 'user-id' } } as any;
      vi.mocked(auth.api.getSession).mockResolvedValue(session);
      vi.mocked(verifySuperAdmin).mockResolvedValue({
        authorized: false,
        error: 'Platform organization not found',
      });

      const result = await requireSuperAdmin(mockHeaders);

      expect(result.status).toBe(503);
      expect(result.error).toBe('Platform organization not found');
    });
  });

  describe('headers handling', () => {
    it('should use provided requestHeaders if passed', async () => {
      const customHeaders = new Headers({ 'x-custom': 'true' });
      vi.mocked(auth.api.getSession).mockResolvedValue(null as any);

      await requireSuperAdmin(customHeaders);

      expect(auth.api.getSession).toHaveBeenCalledWith({ headers: customHeaders });
      expect(nextHeaders).not.toHaveBeenCalled();
    });

    it('should fall back to next/headers if no requestHeaders are passed', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null as any);

      await requireSuperAdmin();

      expect(nextHeaders).toHaveBeenCalled();
      expect(auth.api.getSession).toHaveBeenCalledWith({ headers: mockNextHeaders });
    });
  });
});
