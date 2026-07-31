#!/bin/sh
set -e

# ============================================================================
# Combined PostgreSQL + PgBouncer entrypoint
# ============================================================================

echo "🐘 Initializing PostgreSQL..."

# Initialize database if not already initialized
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  su postgres -c "initdb -D $PGDATA"
else
  echo "🐘 Database already initialized, skipping initdb"
fi

# Configure PostgreSQL to listen on all interfaces and use trust auth (test env)
grep -q "listen_addresses" "$PGDATA/postgresql.conf" || echo "listen_addresses='*'" >> "$PGDATA/postgresql.conf"
grep -q "^port=5432" "$PGDATA/postgresql.conf" || echo "port=5432" >> "$PGDATA/postgresql.conf"

# Use trust auth for all connections (safe for test environment)
cat > "$PGDATA/pg_hba.conf" <<EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             0.0.0.0/0               trust
host    all             all             ::0/0                   trust
local   replication     all                                     trust
host    replication     all             0.0.0.0/0               trust
host    replication     all             ::0/0                   trust
EOF

echo "🐘 Starting PostgreSQL on port 5432..."
su postgres -c "pg_ctl -D $PGDATA -l /tmp/postgres.log start"

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL..."
until pg_isready -h 127.0.0.1 -p 5432; do
  sleep 1
done

# Create the test user and database if they don't exist
echo "📦 Setting up test database..."
su postgres -c "psql -p 5432 -d postgres -c \"CREATE USER postgres WITH PASSWORD 'postgres' SUPERUSER;\"" 2>/dev/null || echo "User postgres already exists"
su postgres -c "psql -p 5432 -d postgres -c \"CREATE DATABASE nipp_test OWNER postgres;\"" 2>/dev/null || echo "Database nipp_test already exists"

# Configure PgBouncer - run as postgres user
echo "🔵 Configuring PgBouncer..."

# Create log directory with proper permissions
mkdir -p /var/log/pgbouncer
chown postgres:postgres /var/log/pgbouncer

# Create userlist.txt with proper format: "username" "password"
echo '"postgres" "postgres"' > /etc/pgbouncer/userlist.txt
chown postgres:postgres /etc/pgbouncer/userlist.txt

# Update pgbouncer.ini settings
sed -i "s/^listen_port = .*/listen_port = 6432/" /etc/pgbouncer/pgbouncer.ini
sed -i "s/^listen_addr = .*/listen_addr = 0.0.0.0/" /etc/pgbouncer/pgbouncer.ini
sed -i "s/^pool_mode = .*/pool_mode = transaction/" /etc/pgbouncer/pgbouncer.ini
sed -i "s/^default_pool_size = .*/default_pool_size = 20/" /etc/pgbouncer/pgbouncer.ini
sed -i "s/^max_client_conn = .*/max_client_conn = 100/" /etc/pgbouncer/pgbouncer.ini
sed -i "s/^auth_type = .*/auth_type = md5/" /etc/pgbouncer/pgbouncer.ini

# Add database entry to [databases] section (append after the section header)
if ! grep -q "^nipp_test" /etc/pgbouncer/pgbouncer.ini; then
  sed -i '/^\[databases\]/a nipp_test = host=127.0.0.1 port=5432 dbname=nipp_test' /etc/pgbouncer/pgbouncer.ini
fi

echo "🔵 Starting PgBouncer on port 6432 as postgres user..."
exec su postgres -c "/usr/bin/pgbouncer /etc/pgbouncer/pgbouncer.ini"
