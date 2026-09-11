/**
 * Minimal ambient types for @breejs/later (ships without TypeScript
 * declarations; the full typings are not published). Covers exactly the API
 * surface lib/job-scheduler-engine.ts uses — parse.cron + schedule().prev/next.
 */

declare module '@breejs/later' {
  export interface ScheduleData {
    schedules: unknown[];
    exceptions?: unknown[];
  }

  export interface LaterDateModule {
    localTime(): void;
    utc(): void;
    timezone(useLocalTime: boolean): void;
    [key: string]: unknown;
  }

  export interface LaterParseModule {
    // (expr, hasSeconds?, timezone?) → parsed schedule data for later.schedule()
    cron(expr: string, hasSeconds?: boolean, timezone?: string): ScheduleData;
    interval(value: string | number): ScheduleData;
  }

  export class Schedule {
    // count === 1 (or 2 for next) resolves to a single Date per later.js docs;
    // other counts return an array. Keep the overloads before the general form.
    prev(count: 1, startDate?: Date, endDate?: Date): Date;
    next(count: 1, startDate?: Date, endDate?: Date): Date;
    next(count: 2, startDate?: Date, endDate?: Date): Date;
    prev(count?: number, startDate?: Date, endDate?: Date): Date | Date[];
    next(count?: number, startDate?: Date, endDate?: Date): Date | Date[];
    prevRange(
      count?: number,
      startDate?: Date,
      endDate?: Date,
    ): [Date, Date?] | Array<[Date, Date?]>;
    nextRange(
      count?: number,
      startDate?: Date,
      endDate?: Date,
    ): [Date, Date?] | Array<[Date, Date?]>;
    isValid(d?: Date): boolean;
  }

  const later: {
    date: LaterDateModule & Record<string, unknown>;
    parse: LaterParseModule;
    schedule(data: ScheduleData): Schedule;
    setInterval(
      fn: () => void,
      data: ScheduleData,
      timezone?: string,
      options?: Record<string, unknown>,
    ): { clear(): void };
    setTimeout(
      fn: () => void,
      data: ScheduleData,
      timezone?: string,
      options?: Record<string, unknown>,
    ): { clear(): void };
    NEVER: number;
  };

  export default later;
}
