/**
 * CalendarService — CRUD operations for organization-scoped calendars.
 *
 * All methods enforce authorization via ServiceContext and tenant isolation
 * is enforced by the Prisma Extension (lib/tenant-db.ts) + PostgreSQL RLS.
 */

import globalDb from '@/lib/global-db';
import { logger } from '@/lib/logger';
import {
  ServiceContext,
  ValidationError,
  NotFoundError,
  ConflictError,
} from '@/lib/services/types';
import { requireAnyAdmin } from '@/lib/services/base-service';

// ---------------------------------------------------------------------------
// Input / Output Types
// ---------------------------------------------------------------------------

export interface CreateCalendarInput {
  name: string;
  description?: string | null;
}

export interface UpdateCalendarInput {
  name?: string;
  description?: string | null;
  color?: string;
}

export interface CalendarWithCount {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Default calendar color palette
// ---------------------------------------------------------------------------

const DEFAULT_CALENDAR_COLORS = [
  '#1B2A4A', // Navy (default)
  '#2A9D8F', // Teal
  '#E76F51', // Orange
  '#7B68AE', // Purple
];

let colorIndex = 0;

function getNextDefaultColor(): string {
  const color = DEFAULT_CALENDAR_COLORS[colorIndex % DEFAULT_CALENDAR_COLORS.length];
  colorIndex++;
  return color;
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

/**
 * Create a new calendar within an organization.
 */
export async function createCalendar(
  ctx: ServiceContext,
  input: CreateCalendarInput,
): Promise<CalendarWithCount> {
  requireAnyAdmin(ctx);

  if (!input.name || input.name.trim().length === 0) {
    throw new ValidationError('Calendar name is required');
  }

  const orgId = ctx.organizationId;
  if (!orgId) {
    throw new ValidationError('Organization context is required');
  }

  // Check for duplicate name within the org (tenant isolation via Prisma Extension)
  const existing = await globalDb.calendar.findFirst({
    where: { organizationId: orgId, name: input.name.trim() },
  });

  if (existing) {
    throw new ConflictError(
      `A calendar with the name "${input.name.trim()}" already exists in this organization`,
    );
  }

  const calendar = await globalDb.calendar.create({
    data: {
      name: input.name.trim(),
      description: input.description,
      color: getNextDefaultColor(),
      isDefault: false,
      organization: { connect: { id: orgId } },
    },
  });

  logger.info(
    { userId: ctx.userId, calendarId: calendar.id },
    `Calendar created: ${calendar.name}`,
  );

  return {
    id: calendar.id,
    name: calendar.name,
    description: calendar.description,
    color: calendar.color,
    isDefault: calendar.isDefault,
    createdAt: calendar.createdAt,
    updatedAt: calendar.updatedAt,
  };
}

/**
 * List all calendars within an organization.
 */
export async function getCalendars(
  ctx: ServiceContext,
  orgId?: string,
): Promise<CalendarWithCount[]> {
  const targetOrgId = orgId ?? ctx.organizationId;

  if (!targetOrgId) {
    throw new ValidationError('Organization context is required');
  }

  const calendars = await globalDb.calendar.findMany({
    where: { organizationId: targetOrgId },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });

  return calendars.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    color: c.color,
    isDefault: c.isDefault,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
}

/**
 * Get a single calendar by ID.
 */
export async function getCalendarById(
  ctx: ServiceContext,
  calendarId: string,
): Promise<CalendarWithCount> {
  const calendar = await globalDb.calendar.findFirst({
    where: { id: calendarId, organizationId: ctx.organizationId! },
  });

  if (!calendar) {
    throw new NotFoundError(`Calendar with ID "${calendarId}" not found`);
  }

  return {
    id: calendar.id,
    name: calendar.name,
    description: calendar.description,
    color: calendar.color,
    isDefault: calendar.isDefault,
    createdAt: calendar.createdAt,
    updatedAt: calendar.updatedAt,
  };
}

/**
 * Update a calendar's properties.
 */
export async function updateCalendar(
  ctx: ServiceContext,
  calendarId: string,
  input: UpdateCalendarInput,
): Promise<CalendarWithCount> {
  requireAnyAdmin(ctx);

  const calendar = await globalDb.calendar.findFirst({
    where: { id: calendarId, organizationId: ctx.organizationId! },
  });

  if (!calendar) {
    throw new NotFoundError(`Calendar with ID "${calendarId}" not found`);
  }

  const updateData: Record<string, unknown> = {};

  if (input.name !== undefined) {
    if (input.name.trim().length === 0) {
      throw new ValidationError('Calendar name cannot be empty');
    }
    updateData.name = input.name.trim();
  }

  if (input.description !== undefined) {
    updateData.description = input.description;
  }

  if (input.color !== undefined) {
    updateData.color = input.color;
  }

  const updated = await globalDb.calendar.update({
    where: { id: calendarId, organizationId: ctx.organizationId! },
    data: updateData,
  });

  logger.info(
    { userId: ctx.userId, calendarId: updated.id },
    `Calendar updated: ${updated.name}`,
  );

  return {
    id: updated.id,
    name: updated.name,
    description: updated.description,
    color: updated.color,
    isDefault: updated.isDefault,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Delete a calendar and cascade to its events.
 */
export async function deleteCalendar(
  ctx: ServiceContext,
  calendarId: string,
): Promise<void> {
  requireAnyAdmin(ctx);

  const calendar = await globalDb.calendar.findFirst({
    where: { id: calendarId, organizationId: ctx.organizationId! },
  });

  if (!calendar) {
    throw new NotFoundError(`Calendar with ID "${calendarId}" not found`);
  }

  // Prevent deletion of the last default calendar
  if (calendar.isDefault) {
    throw new ValidationError('Cannot delete the default calendar');
  }

  await globalDb.calendar.delete({
    where: { id: calendarId, organizationId: ctx.organizationId! },
  });

  logger.info(
    { userId: ctx.userId, calendarId },
    `Calendar deleted`,
  );
}

/**
 * Get the default calendar for an organization (returns null if none exists).
 */
export async function getDefaultCalendar(
  ctx: ServiceContext,
  orgId?: string,
): Promise<CalendarWithCount | null> {
  const targetOrgId = orgId ?? ctx.organizationId;

  if (!targetOrgId) {
    throw new ValidationError('Organization context is required');
  }

  const calendar = await globalDb.calendar.findFirst({
    where: { organizationId: targetOrgId, isDefault: true },
  });

  if (!calendar) {
    return null;
  }

  return {
    id: calendar.id,
    name: calendar.name,
    description: calendar.description,
    color: calendar.color,
    isDefault: calendar.isDefault,
    createdAt: calendar.createdAt,
    updatedAt: calendar.updatedAt,
  };
}

/**
 * Ensure a default calendar exists for the organization.
 * Creates one if it does not exist (bootstrapping).
 */
export async function ensureDefaultCalendar(
  ctx: ServiceContext,
  orgId?: string,
): Promise<CalendarWithCount> {
  const targetOrgId = orgId ?? ctx.organizationId;

  if (!targetOrgId) {
    throw new ValidationError('Organization context is required');
  }

  const existing = await globalDb.calendar.findFirst({
    where: { organizationId: targetOrgId, isDefault: true },
  });

  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      description: existing.description,
      color: existing.color,
      isDefault: existing.isDefault,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
  }

  // Create default calendar
  const created = await globalDb.calendar.create({
    data: {
      name: 'Main Calendar',
      description: 'Default calendar for this organization',
      color: '#1B2A4A', // Navy
      isDefault: true,
      organization: { connect: { id: targetOrgId } },
    },
  });

  logger.info(
    { userId: ctx.userId, calendarId: created.id },
    `Default calendar bootstrapped for org ${targetOrgId}`,
  );

  return {
    id: created.id,
    name: created.name,
    description: created.description,
    color: created.color,
    isDefault: created.isDefault,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

/**
 * CalendarService — full CRUD with authorization and bootstrapping.
 */
export const CalendarService = {
  createCalendar,
  getCalendars,
  getCalendarById,
  updateCalendar,
  deleteCalendar,
  getDefaultCalendar,
  ensureDefaultCalendar,
};
