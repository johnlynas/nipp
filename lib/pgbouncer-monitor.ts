import { Pool } from "pg";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface PgBouncerConfig {
  /** Host of the PgBouncer admin port (default: localhost) */
  host?: string;
  /** Port of PgBouncer admin (default: 6432) */
  port?: number;
  /** Username with admin privileges (default: pgbouncer) */
  user?: string;
  /** Password for admin access */
  password: string;
  /** Database name to connect to (default: pgbouncer) */
  database?: string;
}

export interface PgBouncerDatabase {
  name: string;
  host: string;
  port: number;
  database: string;
  force_user: string;
  force_password: string;
  pool_size: number;
  min_pool_size: number;
  reserve_pool_size: number;
  pool_mode: string;
  max_connections: number;
  current_connections: number;
  disabled: boolean;
}

export interface PgBouncerClient {
  active: boolean;
  user: string;
  database: string;
  state: "active" | "idle" | "tested";
  addr: string;
  port: number;
  local_addr: string;
  local_port: number;
  connect_time: string;
  request_time: string;
  ptr: string;
  link: string;
}

export interface PgBouncerServer {
  active: boolean;
  user: string;
  database: string;
  state: "active" | "idle" | "login" | "tested";
  addr: string;
  port: number;
  local_addr: string;
  local_port: number;
  connect_time: string;
  request_time: string;
  ptr: string;
  link: string;
}

export interface PgBouncerPool {
  database: string;
  user: string;
  pool_mode: string;
  pool_size: number;
  min_pool_size: number;
  reserve_pool_size: number;
  current_server_connections: number;
  inactive_servers: number;
  active_clients: number;
  idle_clients: number;
  tested_clients: number;
  active_servers: number;
  idle_servers: number;
  tested_servers: number;
  dcid: number;
  total_server_connections: number;
}

export interface PgBouncerStats {
  total_xact_count: number;
  total_query_count: number;
  total_received: number;
  total_sent: number;
  total_xact_time: number;
  total_query_time: number;
  total_wait_time: number;
}

export interface PgBouncerStatsReset {
  reset_time: string;
}

export interface PgBouncerShowConfig {
  name: string;
  value: string;
  change: boolean;
}

export interface PgBouncerVersion {
  version: string;
  proto_version: number;
}

export interface PgBouncerStatsSystem {
  total_time: number;
  user_time: number;
  system_time: number;
  total_wait_time: number;
}

export interface PgBouncerStatsDatabases {
  name: string;
  total_xact_count: number;
  total_query_count: number;
  total_received: number;
  total_sent: number;
  total_xact_time: number;
  total_query_time: number;
  total_wait_time: number;
}

export interface PgBouncerStatsUsers {
  name: string;
  total_xact_count: number;
  total_query_count: number;
  total_received: number;
  total_sent: number;
  total_xact_time: number;
  total_query_time: number;
  total_wait_time: number;
}

export interface PgBouncerStats {
  total_xact_count: number;
  total_query_count: number;
  total_received: number;
  total_sent: number;
  total_xact_time: number;
  total_query_time: number;
  total_wait_time: number;
}

export interface PgBouncerStatsReset {
  reset_time: string;
}

export interface PgBouncerHealthStatus {
  isHealthy: boolean;
  uptimeSeconds: number;
  totalConnections: number;
  activeClients: number;
  idleClients: number;
  totalPools: number;
  activePools: number;
  timestamp: Date;
}

export interface PgBouncerMetrics {
  /** Total number of client connections */
  clients_total: number;
  /** Number of active client connections */
  clients_active: number;
  /** Number of idle client connections */
  clients_idle: number;
  /** Total number of server connections */
  servers_total: number;
  /** Number of active server connections */
  servers_active: number;
  /** Number of idle server connections */
  servers_idle: number;
  /** Total transactions processed */
  transactions_total: number;
  /** Total queries processed */
  queries_total: number;
  /** Average transaction time in milliseconds */
  avg_transaction_time_ms: number;
  /** Average query time in milliseconds */
  avg_query_time_ms: number;
  /** Total wait time in milliseconds */
  total_wait_time_ms: number;
  /** Number of configured databases */
  databases_count: number;
  /** Number of configured pools */
  pools_count: number;
  /** Pool utilization percentage (0-100) */
  pool_utilization_percent: number;
}

// ============================================================================
// PgBouncer Monitor Class
// ============================================================================

export class PgBouncerMonitor {
  private pool: Pool | null = null;
  private config: PgBouncerConfig;

  constructor(config: PgBouncerConfig) {
    this.config = {
      host: config.host ?? "localhost",
      port: config.port ?? 6432,
      user: config.user ?? "pgbouncer",
      password: config.password,
      database: config.database ?? "pgbouncer",
    };
  }

  /**
   * Initialize the connection pool to PgBouncer admin interface
   */
  async connect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }

    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      // PgBouncer admin connections are typically short-lived
      max: 5,
      idleTimeoutMillis: 30000,
    });

    // Test the connection
    const client = await this.pool.connect();
    try {
      await client.query("SHOW VERSION");
    } finally {
      client.release();
    }
  }

  /**
   * Close the connection pool
   */
  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  /**
   * Execute a raw SHOW command against PgBouncer admin interface
   */
  private async executeShowCommand<T>(command: string): Promise<T[]> {
    if (!this.pool) {
      throw new Error("Not connected to PgBouncer. Call connect() first.");
    }

    const client = await this.pool.connect();
    try {
      const result = await client.query(command);
      return result.rows as T[];
    } finally {
      client.release();
    }
  }

  // ========================================================================
  // Informational Queries
  // ========================================================================

  /**
   * Get PgBouncer version information
   */
  async getVersion(): Promise<PgBouncerVersion> {
    const rows = await this.executeShowCommand<PgBouncerVersion>(
      "SHOW VERSION"
    );
    return rows[0] ?? { version: "unknown", proto_version: 0 };
  }

  /**
   * Get current PgBouncer configuration settings
   */
  async getConfig(): Promise<PgBouncerShowConfig[]> {
    return this.executeShowCommand<PgBouncerShowConfig>("SHOW CONFIG");
  }

  /**
   * Get a specific configuration value
   */
  async getConfigValue(key: string): Promise<string | null> {
    const rows = await this.executeShowCommand<PgBouncerShowConfig>(
      `SHOW ${key}`
    );
    return rows[0]?.value ?? null;
  }

  // ========================================================================
  // Database & Pool Queries
  // ========================================================================

  /**
   * Get all configured databases in PgBouncer
   */
  async getDatabases(): Promise<PgBouncerDatabase[]> {
    return this.executeShowCommand<PgBouncerDatabase>("SHOW DATABASES");
  }

  /**
   * Get all active pools
   */
  async getPools(): Promise<PgBouncerPool[]> {
    return this.executeShowCommand<PgBouncerPool>("SHOW POOLS");
  }

  // ========================================================================
  // Connection Queries
  // ========================================================================

  /**
   * Get all client connections
   */
  async getClients(): Promise<PgBouncerClient[]> {
    return this.executeShowCommand<PgBouncerClient>("SHOW CLIENTS");
  }

  /**
   * Get all server connections
   */
  async getServers(): Promise<PgBouncerServer[]> {
    return this.executeShowCommand<PgBouncerServer>("SHOW SERVERS");
  }

  /**
   * Get active client connections only
   */
  async getActiveClients(): Promise<PgBouncerClient[]> {
    const clients = await this.getClients();
    return clients.filter((c) => c.active);
  }

  /**
   * Get idle client connections only
   */
  async getIdleClients(): Promise<PgBouncerClient[]> {
    const clients = await this.getClients();
    return clients.filter((c) => !c.active && c.state === "idle");
  }

  // ========================================================================
  // Statistics Queries
  // ========================================================================

  /**
   * Get aggregate statistics for the entire PgBouncer instance
   */
  async getStats(): Promise<PgBouncerStats> {
    const rows = await this.executeShowCommand<PgBouncerStats>("SHOW STATS");
    return (
      rows[0] ?? {
        total_xact_count: 0,
        total_query_count: 0,
        total_received: 0,
        total_sent: 0,
        total_xact_time: 0,
        total_query_time: 0,
        total_wait_time: 0,
      }
    );
  }

  /**
   * Get statistics reset time
   */
  async getStatsReset(): Promise<PgBouncerStatsReset> {
    const rows = await this.executeShowCommand<PgBouncerStatsReset>(
      "SHOW STATS_RESET"
    );
    return (
      rows[0] ?? { reset_time: "unknown" }
    );
  }

  /**
   * Get per-database statistics
   */
  async getStatsDatabases(): Promise<PgBouncerStatsDatabases[]> {
    return this.executeShowCommand<PgBouncerStatsDatabases>(
      "SHOW STATS_DATABASES"
    );
  }

  /**
   * Get per-user statistics
   */
  async getStatsUsers(): Promise<PgBouncerStatsUsers[]> {
    return this.executeShowCommand<PgBouncerStatsUsers>("SHOW STATS_USERS");
  }

  /**
   * Get system statistics (CPU time, etc.)
   */
  async getStatsSystem(): Promise<PgBouncerStatsSystem> {
    const rows = await this.executeShowCommand<PgBouncerStatsSystem>(
      "SHOW STATS_SYSTEM"
    );
    return (
      rows[0] ?? {
        total_time: 0,
        user_time: 0,
        system_time: 0,
        total_wait_time: 0,
      }
    );
  }

  // ========================================================================
  // Health & Metrics
  // ========================================================================

  /**
   * Check if PgBouncer is healthy and responsive
   */
  async checkHealth(): Promise<PgBouncerHealthStatus> {
    try {
      const version = await this.getVersion();
      const clients = await this.getClients();
      const pools = await this.getPools();

      const activeClients = clients.filter((c) => c.active).length;
      const idleClients = clients.filter(
        (c) => !c.active && c.state === "idle"
      ).length;

      return {
        isHealthy: true,
        uptimeSeconds: 0, // PgBouncer doesn't expose uptime directly
        totalConnections: clients.length,
        activeClients,
        idleClients,
        totalPools: pools.length,
        activePools: pools.filter((p) => p.pool_size > 0).length,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        isHealthy: false,
        uptimeSeconds: 0,
        totalConnections: 0,
        activeClients: 0,
        idleClients: 0,
        totalPools: 0,
        activePools: 0,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Get comprehensive metrics for monitoring/alerting systems
   */
  async getMetrics(): Promise<PgBouncerMetrics> {
    const [clients, pools, stats] = await Promise.all([
      this.getClients(),
      this.getPools(),
      this.getStats(),
    ]);

    const activeClients = clients.filter((c) => c.active).length;
    const idleClients = clients.length - activeClients;
    const servers = await this.getServers();
    const activeServers = servers.filter((s) => s.active).length;
    const idleServers = servers.length - activeServers;

    // Calculate pool utilization
    let totalPoolSize = 0;
    let totalActiveServerConnections = 0;
    for (const pool of pools) {
      totalPoolSize += pool.pool_size;
      totalActiveServerConnections +=
        pool.current_server_connections;
    }

    const poolUtilization =
      totalPoolSize > 0
        ? (totalActiveServerConnections / totalPoolSize) * 100
        : 0;

    // Calculate average times (in milliseconds)
    const avgTransactionTime =
      stats.total_xact_count > 0
        ? (stats.total_xact_time / stats.total_xact_count) * 1000
        : 0;

    const avgQueryTime =
      stats.total_query_count > 0
        ? (stats.total_query_time / stats.total_query_count) * 1000
        : 0;

    return {
      clients_total: clients.length,
      clients_active: activeClients,
      clients_idle: idleClients,
      servers_total: servers.length,
      servers_active: activeServers,
      servers_idle: idleServers,
      transactions_total: stats.total_xact_count,
      queries_total: stats.total_query_count,
      avg_transaction_time_ms: avgTransactionTime,
      avg_query_time_ms: avgQueryTime,
      total_wait_time_ms: stats.total_wait_time * 1000,
      databases_count: (await this.getDatabases()).length,
      pools_count: pools.length,
      pool_utilization_percent: Math.round(poolUtilization * 100) / 100,
    };
  }

  // ========================================================================
  // Convenience Methods
  // ========================================================================

  /**
   * Get a complete snapshot of PgBouncer state
   */
  async getSnapshot(): Promise<{
    version: PgBouncerVersion;
    databases: PgBouncerDatabase[];
    clients: PgBouncerClient[];
    servers: PgBouncerServer[];
    pools: PgBouncerPool[];
    stats: PgBouncerStats;
    health: PgBouncerHealthStatus;
    metrics: PgBouncerMetrics;
  }> {
    const [version, databases, clients, servers, pools, stats, health] =
      await Promise.all([
        this.getVersion(),
        this.getDatabases(),
        this.getClients(),
        this.getServers(),
        this.getPools(),
        this.getStats(),
        this.checkHealth(),
      ]);

    const metrics = await this.getMetrics();

    return {
      version,
      databases,
      clients,
      servers,
      pools,
      stats,
      health,
      metrics,
    };
  }

  /**
   * Get connection summary for a specific database
   */
  async getDatabaseSummary(databaseName: string): Promise<{
    database: PgBouncerDatabase | undefined;
    clientCount: number;
    serverCount: number;
    poolInfo: PgBouncerPool | undefined;
  }> {
    const [databases, clients, servers, pools] = await Promise.all([
      this.getDatabases(),
      this.getClients(),
      this.getServers(),
      this.getPools(),
    ]);

    const database = databases.find((d) => d.name === databaseName);
    const clientCount = clients.filter(
      (c) => c.database === databaseName
    ).length;
    const serverCount = servers.filter(
      (s) => s.database === databaseName
    ).length;
    const poolInfo = pools.find(
      (p) => p.database === databaseName && p.user === database?.force_user
    );

    return {
      database,
      clientCount,
      serverCount,
      poolInfo,
    };
  }

  /**
   * Get all databases with their connection counts
   */
  async getDatabaseConnectionCounts(): Promise<
    Array<{
      database: string;
      clientCount: number;
      serverCount: number;
      activeClientCount: number;
    }>
  > {
    const [databases, clients, servers] = await Promise.all([
      this.getDatabases(),
      this.getClients(),
      this.getServers(),
    ]);

    return databases.map((db) => ({
      database: db.name,
      clientCount: clients.filter((c) => c.database === db.name).length,
      serverCount: servers.filter((s) => s.database === db.name).length,
      activeClientCount: clients.filter(
        (c) => c.database === db.name && c.active
      ).length,
    }));
  }

  /**
   * Get users with their connection counts and stats
   */
  async getUserStats(): Promise<
    Array<{
      user: string;
      clientCount: number;
      stats: PgBouncerStatsUsers | undefined;
    }>
  > {
    const [clients, statsUsers] = await Promise.all([
      this.getClients(),
      this.getStatsUsers(),
    ]);

    const userMap = new Map<string, PgBouncerStatsUsers>();
    for (const stat of statsUsers) {
      userMap.set(stat.name, stat);
    }

    const users = [...new Set(clients.map((c) => c.user))];
    return users.map((user) => ({
      user,
      clientCount: clients.filter((c) => c.user === user).length,
      stats: userMap.get(user),
    }));
  }

  /**
   * Get pools with utilization info
   */
  async getPoolUtilization(): Promise<
    Array<{
      database: string;
      user: string;
      poolSize: number;
      activeConnections: number;
      utilizationPercent: number;
    }>
  > {
    const pools = await this.getPools();

    return pools.map((pool) => ({
      database: pool.database,
      user: pool.user,
      poolSize: pool.pool_size,
      activeConnections: pool.current_server_connections,
      utilizationPercent:
        pool.pool_size > 0
          ? Math.round(
              (pool.current_server_connections / pool.pool_size) * 10000
            ) / 100
          : 0,
    }));
  }

  /**
   * Get pools that are near capacity (>80% utilization)
   */
  async getOverloadedPools(threshold = 0.8): Promise<
    Array<{
      database: string;
      user: string;
      poolSize: number;
      activeConnections: number;
      utilizationPercent: number;
    }>
  > {
    const pools = await this.getPoolUtilization();
    return pools.filter((p) => p.utilizationPercent / 100 >= threshold);
  }

  /**
   * Get clients that have been idle for more than specified seconds
   */
  async getStaleClients(maxIdleSeconds: number = 300): Promise<PgBouncerClient[]> {
    const clients = await this.getClients();
    const now = Date.now();

    return clients.filter((client) => {
      if (client.active) return false;
      
      try {
        const connectTime = new Date(client.connect_time).getTime();
        const idleSeconds = (now - connectTime) / 1000;
        return idleSeconds > maxIdleSeconds;
      } catch {
        return false;
      }
    });
  }

  /**
   * Get servers that have been idle for more than specified seconds
   */
  async getStaleServers(maxIdleSeconds: number = 300): Promise<PgBouncerServer[]> {
    const servers = await this.getServers();
    const now = Date.now();

    return servers.filter((server) => {
      if (server.active) return false;
      
      try {
        const connectTime = new Date(server.connect_time).getTime();
        const idleSeconds = (now - connectTime) / 1000;
        return idleSeconds > maxIdleSeconds;
      } catch {
        return false;
      }
    });
  }

  /**
   * Get a human-readable summary of PgBouncer status
   */
  async getSummary(): Promise<string> {
    const [version, databases, clients, servers, pools, stats] =
      await Promise.all([
        this.getVersion(),
        this.getDatabases(),
        this.getClients(),
        this.getServers(),
        this.getPools(),
        this.getStats(),
      ]);

    const activeClients = clients.filter((c) => c.active).length;
    const idleClients = clients.length - activeClients;
    const activeServers = servers.filter((s) => s.active).length;
    const idleServers = servers.length - activeServers;

    let summary = `PgBouncer Monitor Summary\n`;
    summary += `${"=".repeat(40)}\n\n`;
    summary += `Version: ${version.version}\n`;
    summary += `Configured Databases: ${databases.length}\n\n`;

    summary += `Connections:\n`;
    summary += `  Clients: ${clients.length} (Active: ${activeClients}, Idle: ${idleClients})\n`;
    summary += `  Servers: ${servers.length} (Active: ${activeServers}, Idle: ${idleServers})\n\n`;

    summary += `Statistics:\n`;
    summary += `  Total Transactions: ${stats.total_xact_count.toLocaleString()}\n`;
    summary += `  Total Queries: ${stats.total_query_count.toLocaleString()}\n`;
    summary += `  Data Received: ${(stats.total_received / 1024 / 1024).toFixed(2)} MB\n`;
    summary += `  Data Sent: ${(stats.total_sent / 1024 / 1024).toFixed(2)} MB\n`;

    return summary;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new PgBouncerMonitor instance from environment variables or config
 */
export function createPgBouncerMonitor(
  config?: Partial<PgBouncerConfig>
): PgBouncerMonitor {
  const envPassword = process.env.PGBOUNCER_PASSWORD;
  
  if (!config?.password && !envPassword) {
    throw new Error(
      "PgBouncer password is required. Pass it in config or set PGBOUNCER_PASSWORD env var."
    );
  }

  return new PgBouncerMonitor({
    host: config?.host ?? process.env.PGBOUNCER_HOST ?? "localhost",
    port: config?.port
      ? parseInt(config.port.toString())
      : process.env.PGBOUNCER_PORT
        ? parseInt(process.env.PGBOUNCER_PORT)
        : 6432,
    user: config?.user ?? process.env.PGBOUNCER_USER ?? "pgbouncer",
    password: config?.password ?? envPassword ?? "",
    database: config?.database ?? process.env.PGBOUNCER_DATABASE ?? "pgbouncer",
  });
}

// ============================================================================
// Example Usage
// ============================================================================

/*
import { PgBouncerMonitor, createPgBouncerMonitor } from "./lib/pgbouncer-monitor";

// Method 1: Direct instantiation
const monitor = new PgBouncerMonitor({
  host: "localhost",
  port: 6432,
  user: "pgbouncer",
  password: "your-admin-password",
});

// Method 2: From environment variables
const monitor = createPgBouncerMonitor({
  password: process.env.PGBOUNCER_PASSWORD,
});

// Connect to PgBouncer
await monitor.connect();

// Get a complete snapshot
const snapshot = await monitor.getSnapshot();
console.log(snapshot.version);
console.log(snapshot.metrics);

// Check health
const health = await monitor.checkHealth();
if (!health.isHealthy) {
  console.error("PgBouncer is not healthy!");
}

// Get metrics for monitoring systems (Prometheus, Grafana, etc.)
const metrics = await monitor.getMetrics();
console.log(`Active clients: ${metrics.clients_active}`);
console.log(`Pool utilization: ${metrics.pool_utilization_percent}%`);

// Get overloaded pools
const overloaded = await monitor.getOverloadedPools(0.8);
if (overloaded.length > 0) {
  console.warn("Overloaded pools detected:", overloaded);
}

// Get a human-readable summary
const summary = await monitor.getSummary();
console.log(summary);

// Disconnect when done
await monitor.disconnect();
*/
