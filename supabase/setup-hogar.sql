-- Ejecutar UNA vez en Supabase > SQL Editor, DESPUÉS de pegar la migración
-- (supabase/migrations/20261025000000_init.sql).
-- Sustituye los dos emails antes de ejecutarlo (no se guardan en el repositorio).
-- Crea el hogar, las categorías, las tiendas habituales y autoriza los dos emails.
-- Después, crea los dos usuarios en Authentication > Users > Add user (con contraseña
-- y "Auto Confirm User" marcado): quedan unidos al hogar automáticamente.
select public.setup_household(
  'Casa',
  '[{"email": "EMAIL_DE_MIKE", "name": "Mike"},
    {"email": "EMAIL_DE_SILVIA", "name": "Silvia"}]'::jsonb
);
