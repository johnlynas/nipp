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
let previousHealthState: {
  database: 'healthy' | 'unhealthy' | null;
  cache: 'healthy' | 'unhealthy' | null;
} = {
  database: null,
  cache: null,
};

export function getPreviousHealthState() {
  return previousHealthState;
}

export function updateHealthState(database: 'healthy' | 'unhealthy', cache: 'healthy' | 'unhealthy') {
  previousHealthState = { database, cache };
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
