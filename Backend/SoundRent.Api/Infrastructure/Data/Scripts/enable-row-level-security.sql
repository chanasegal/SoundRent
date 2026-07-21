-- =============================================================================
-- SoundRent — Supabase Row Level Security (RLS) lockdown
-- Run in: Supabase Dashboard → SQL Editor
--
-- Architecture note
-- -----------------
-- This app does NOT use Supabase Auth / PostgREST for data access.
-- The Angular client talks only to the ASP.NET API, which connects as the
-- Postgres role (superuser / BYPASSRLS) and therefore is unaffected by RLS.
--
-- Goal: make every public table unreadable/unwritable via the anon key,
-- authenticated role, and any accidental PostgREST exposure.
-- With RLS enabled + FORCE + zero policies, default-deny applies to
-- anon/authenticated. REVOKE removes GRANT privileges as a second layer.
--
-- Do NOT add permissive auth.uid() policies unless you migrate to Supabase
-- Auth and expose tables through PostgREST with real per-user ownership.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: enable RLS, force it for table owners that lack BYPASSRLS, revoke
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    -- Auth / staff
    'Users',
    -- Customers & institutions
    'Customers',
    'CustomerSystems',
    'Institutions',
    'InstitutionSystems',
    'CustomerDebts',
    -- Equipment rental
    'Equipments',
    'EquipmentDefinitions',
    'Orders',
    'OrderEquipments',
    'OrderShifts',
    'OrderLoanedEquipments',
    'OrderCustomMissingItems',
    'ManualUnreturnedItems',
    'LoanedEquipmentNotes',
    'WaitlistEntries',
    'LostEquipments',
    'BlockedDates',
    'GeneralMemos',
    -- Accessory / serial inventory
    'AccessorySerialInventory',
    'EquipmentDefaultAccessories',
    'InventoryDefinitions',
    'InventorySerialCodes',
    -- Tools
    'ToolDefinitions',
    'ToolSerialCodes',
    'ToolLoans',
    'ToolLoanItems',
    -- Library
    'Books',
    'BookCopies',
    'BookLoans',
    'BookLoanItems',
    -- EF Core metadata
    '__EFMigrationsHistory'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      RAISE NOTICE 'Skipping missing table: %', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', tbl);
    RAISE NOTICE 'RLS locked: %', tbl;
  END LOOP;
END $$;

-- Sequences (identity / serial columns) — block direct nextval from clients
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Future tables created in public: default privileges for anon/authenticated
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- Safety net: any other public base table without RLS yet
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
      AND c.relname NOT LIKE 'pg_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', r.table_name);
    RAISE NOTICE 'RLS enabled (catch-all) on %', r.table_name;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Explicit: NO CREATE POLICY statements
-- Zero policies = deny all for roles subject to RLS (anon, authenticated).
-- service_role / postgres (BYPASSRLS) retain full access for the ASP.NET API.
-- -----------------------------------------------------------------------------

-- Optional verification (run separately if desired):
-- SELECT relname, relrowsecurity, relforcerowsecurity
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r'
-- ORDER BY relname;
