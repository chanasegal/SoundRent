-- Run in Supabase Dashboard → SQL Editor (project: gcfsvgertouifupglvrc / zichron_moshe)
-- Secures public tables from anon/authenticated PostgREST access.
-- Does NOT affect the ASP.NET API (connects as postgres, bypasses RLS).

ALTER TABLE public."Customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Customers" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Customers" FROM anon, authenticated;

ALTER TABLE public."EquipmentDefinitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EquipmentDefinitions" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."EquipmentDefinitions" FROM anon, authenticated;

ALTER TABLE public."Equipments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Equipments" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Equipments" FROM anon, authenticated;

ALTER TABLE public."Orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Orders" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Orders" FROM anon, authenticated;

ALTER TABLE public."OrderEquipments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderEquipments" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."OrderEquipments" FROM anon, authenticated;

ALTER TABLE public."OrderShifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderShifts" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."OrderShifts" FROM anon, authenticated;

ALTER TABLE public."OrderLoanedEquipments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderLoanedEquipments" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."OrderLoanedEquipments" FROM anon, authenticated;

ALTER TABLE public."LoanedEquipmentNotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LoanedEquipmentNotes" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."LoanedEquipmentNotes" FROM anon, authenticated;

ALTER TABLE public."Users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Users" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Users" FROM anon, authenticated;

ALTER TABLE public."WaitlistEntries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WaitlistEntries" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."WaitlistEntries" FROM anon, authenticated;

ALTER TABLE public."__EFMigrationsHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."__EFMigrationsHistory" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."__EFMigrationsHistory" FROM anon, authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Catch any other user tables created later in public (optional safety net):
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
    RAISE NOTICE 'RLS enabled on %', r.table_name;
  END LOOP;
END $$;
