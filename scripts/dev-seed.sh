#!/usr/bin/env bash
# Datos de prueba para el Supabase local: un hogar con dos usuarios y un intruso.
set -euo pipefail
DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres
API=http://127.0.0.1:54321
SECRET=$(npx supabase status -o json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).SERVICE_ROLE_KEY))')
psql "$DB" -qc "select public.setup_household('Casa', '[{\"email\":\"mike@test.local\",\"name\":\"Mike\"},{\"email\":\"silvia@test.local\",\"name\":\"Silvia\"}]'::jsonb)"
for u in mike silvia intruso; do
  curl -sS -o /dev/null -w "$u %{http_code}\n" "$API/auth/v1/admin/users" -H "apikey: $SECRET" -H "Authorization: Bearer $SECRET" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$u@test.local\",\"password\":\"prueba1234\",\"email_confirm\":true}"
done
psql "$DB" -c "select display_name, email from public.members"
