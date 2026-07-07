-- ============================================================
-- Property NI — Database Setup Script
-- ============================================================
-- Run this file to create the development database.
-- Usage: psql -U postgres -f scripts/setup-db.sql
-- ============================================================

-- Create the development database (idempotent — safe to re-run)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'nipp_dev') THEN
        CREATE DATABASE nipp_dev;
        RAISE NOTICE 'Created database: nipp_dev';
    ELSE
        RAISE NOTICE 'Database already exists: nipp_dev — skipping creation.';
    END IF;
END
$$;

-- Create the production-like database (for local-prod development)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'nipp_prod') THEN
        CREATE DATABASE nipp_prod;
        RAISE NOTICE 'Created database: nipp_prod';
    ELSE
        RAISE NOTICE 'Database already exists: nipp_prod — skipping creation.';
    END IF;
END
$$;
