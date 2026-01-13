-- PostgreSQL schema for construction.data
-- Run this against your local `construction` database.

-- Ensure required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS citext;

-- Create logical schema
CREATE SCHEMA IF NOT EXISTS data;

SET search_path TO data, public;

-- =========================
-- Users
-- =========================
CREATE TABLE IF NOT EXISTS users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           citext NOT NULL UNIQUE,
    hashed_password text   NOT NULL,
    full_name       text,
    is_active       boolean NOT NULL DEFAULT TRUE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    last_login_at   timestamptz
);

-- Keep email lookups fast
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- =========================
-- Projects
-- =========================
CREATE TABLE IF NOT EXISTS projects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES data.users(id) ON DELETE CASCADE,
    name        text NOT NULL,
    description text,
    is_archived boolean NOT NULL DEFAULT FALSE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects (user_id);
CREATE INDEX IF NOT EXISTS idx_projects_user_id_created_at ON projects (user_id, created_at DESC);

-- =========================
-- Images within Projects
-- =========================
-- Each row represents one wall image in a project and holds both
-- original + orthographic paths and latest analysis results.
CREATE TABLE IF NOT EXISTS project_images (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id              uuid NOT NULL REFERENCES data.projects(id) ON DELETE CASCADE,

    original_filename       text NOT NULL,
    storage_original_path   text NOT NULL,
    storage_transformed_path text,

    width_px                integer NOT NULL,
    height_px               integer NOT NULL,

    real_width              double precision,   -- in real_unit
    real_height             double precision,
    real_unit               text,               -- 'm' or 'ft'

    -- Latest mask / coverage numbers from the webapp
    mask_coverage_percent   double precision,   -- 0-100, on usable area
    deselect_area           double precision,   -- same unit^2 as real_unit
    effective_deselect_area double precision,   -- clamped to total facade area
    usable_area             double precision,   -- total - effective_deselect_area
    cemented_area           double precision,   -- usable * maskCoverage
    cemented_percent        double precision,   -- cemented_area / totalArea * 100

    sort_key_numeric        double precision,   -- optional: cached numeric sort (e.g. cemented_area)

    status                  text NOT NULL DEFAULT 'new', -- new|processing|ready|error
    error_message           text,

    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_images_project_id ON project_images (project_id);
CREATE INDEX IF NOT EXISTS idx_images_project_created_at ON project_images (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_project_cemented_area ON project_images (project_id, cemented_area DESC NULLS LAST);

-- Create enum type only if it does not already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'deselect_shape' AND n.nspname = 'data'
  ) THEN
    CREATE TYPE deselect_shape AS ENUM ('rect', 'circle', 'irregular');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS image_deselections (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    image_id    uuid NOT NULL REFERENCES data.project_images(id) ON DELETE CASCADE,

    shape       deselect_shape NOT NULL,
    count       integer NOT NULL DEFAULT 1,

    -- For rect / circle (linear dims in real_unit)
    length      double precision,
    breadth     double precision,
    diameter    double precision,

    -- For irregular shapes, direct area input (in area_unit^2)
    area        double precision,

    unit        text NOT NULL, -- 'm' or 'ft' (or their squared versions interpreted by frontend)

    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_image_deselections_image_id ON image_deselections (image_id);

-- =========================
-- Simple audit trail (optional, for future scale)
-- =========================
CREATE TABLE IF NOT EXISTS audit_logs (
    id          bigserial PRIMARY KEY,
    user_id     uuid REFERENCES data.users(id) ON DELETE SET NULL,
    event_type  text NOT NULL,
    entity_type text,
    entity_id   uuid,
    payload     jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- Triggers to auto-update updated_at
-- =========================
CREATE OR REPLACE FUNCTION data.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'set_projects_updated_at'
  ) THEN
    CREATE TRIGGER set_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION data.set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'set_project_images_updated_at'
  ) THEN
    CREATE TRIGGER set_project_images_updated_at
    BEFORE UPDATE ON project_images
    FOR EACH ROW
    EXECUTE FUNCTION data.set_updated_at();
  END IF;
END $$;
