// In-memory log store for system health errors
// In production, this could be replaced with a database table or external logging service

interface SystemLogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
  details?: string;
}

// Store last 100 log entries
const MAX_LOG_ENTRIES = 100;
const logStore: SystemLogEntry[] = [];

// Track previous health state to avoid duplicate logs
type HealthState = {
  database: 'healthy' | 'unhealthy' | null;
  cache: 'healthy' | 'unhealthy' | null;
  pgbouncer: 'healthy' | 'unhealthy' | null;
};

/** Shared across all module instances (Next.js dev mode can load the same module twice). */
function getHealthState(): HealthState {
  const g = globalThis as unknown as Record<string, HealthState>;
  if (!g.__nipp_healthState) {
    g.__nipp_healthState = { database: null, cache: null, pgbouncer: null };
  }
  return g.__nipp_healthState;
}

let currentHealthState = getHealthState();

export function getPreviousHealthState(): HealthState {
  // Always read from the shared global state (may have been replaced by another module instance)
  return getHealthState();
}

export function updateHealthState(
  database: 'healthy' | 'unhealthy',
  cache: 'healthy' | 'unhealthy',
  pgbouncer?: 'healthy' | 'unhealthy'
) {
  // Update the shared global state object (not a new one) so all module instances see the same values
  const shared = getHealthState();
  shared.database = database;
  shared.cache = cache;
  shared.pgbouncer = pgbouncer || null;
}

export function clearHealthState() {
  const shared = getHealthState();
  shared.database = null;
  shared.cache = null;
  shared.pgbouncer = null;
}

export function addSystemLog(entry: Omit<SystemLogEntry, 'timestamp'>) {
  const logEntry: SystemLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  
  // Prevent duplicates: check if the same message/source was added in the last second
  const recentDuplicate = logStore.find(log => 
    log.message === logEntry.message && 
    log.source === logEntry.source &&
    (Date.now() - new Date(log.timestamp).getTime()) < 1000
  );
  
  if (!recentDuplicate) {
    logStore.unshift(logEntry);
    
    // Trim to max size
    if (logStore.length > MAX_LOG_ENTRIES) {
      logStore.pop();
    }
  }
  
  return logEntry;
}

export function getSystemLogs(limit: number = 50): SystemLogEntry[] {
  return logStore.slice(0, limit);
}

export function clearSystemLogs() {
  logStore.length = 0;
}
