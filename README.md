# Casa · Compras

App web instalable (PWA) para gestionar entre dos personas la lista de la compra, lo que hay en casa y el gasto mensual.

- **App:** React + TypeScript + Vite, instalable desde el navegador del móvil.
- **Datos:** Supabase (Postgres + Auth + Realtime). Reglas de acceso (RLS) por hogar.
- **Alojamiento:** GitHub Pages, publicado al hacer push a `main`.
- **Coste:** 0 €/mes con los planes gratuitos.

## Qué hace (MVP)

| Pantalla | Para qué |
| --- | --- |
| Inicio | Pendientes de la lista, gasto del mes frente a presupuesto, previsión y avisos de caducidad o reposición |
| Lista | Añadir con autocompletado, aviso de duplicados, cantidades, marcar, agrupar por categoría o tienda, habituales con un toque, cerrar compra |
| En casa | Inventario por ubicación, caducidades, mínimos, «Se acabó» y desperdicio |
| Menú | Comidas L-V y cenas de la semana, propuesta automática que aprovecha lo que hay y lo que caduca, recetario editable y «Lo que falta» para la lista |
| Gastos | Gasto por grupo, tienda y producto, presupuesto, compras registradas, indicadores |
| Más | Catálogo con precio por kg/l/ud e historial de precios, tiendas, categorías, exportación CSV/JSON, cuenta |

Funciona sin conexión: los cambios se guardan en el móvil y se envían al recuperarla. Cerrar una compra sí necesita conexión.

## Puesta en marcha (una vez)

1. Crear un proyecto en [supabase.com](https://supabase.com) (región UE).
2. En **SQL Editor**, pegar y ejecutar en orden los archivos de `supabase/migrations/`.
3. Editar los emails de `supabase/setup-hogar.sql` y ejecutarlo.
4. En **Authentication → Sign In / Providers**, desactivar «Allow new users to sign up».
5. En **Authentication → Users → Add user**, crear los dos usuarios con contraseña y «Auto Confirm User».
6. En **Authentication → URL Configuration**, poner como Site URL la dirección de GitHub Pages.
7. Poner la URL del proyecto y la clave pública en `.env.production` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Son públicas por diseño: la seguridad la dan las reglas de acceso.
8. Repositorio público y, en **Settings → Pages**, origen «GitHub Actions». Cada push a `main` publica la app.

Copia semanal cifrada (opcional): secretos `SUPABASE_DB_URL` y `BACKUP_PASSWORD`; ver `.github/workflows/backup.yml`.

## Desarrollo

```bash
npm install
npx supabase start          # Supabase local (Docker)
./scripts/dev-seed.sh       # hogar de prueba: mike@test.local / silvia@test.local, contraseña prueba1234
npm run dev
npm test                    # cálculos (precio unitario, gasto, previsión, avisos)
npm run build && npx vite preview --port 4173 &
node e2e/run.mjs            # prueba completa con dos usuarios a la vez
```

`.env.local` en desarrollo:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<PUBLISHABLE_KEY de `npx supabase status`>
```

## Decisiones

- **El ahorro solo se calcula tras un mes de medición.** El primer mes es la línea base.
- **Los precios no se inventan:** salen de tickets o se introducen a mano, y cada uno guarda su origen (ticket, manual, estimado, oferta verificada).
- **Nada se compra ni se añade solo:** reposición y habituales se proponen y se confirman con un toque.
- **Un producto solo puede estar una vez en la lista** (índice único en la base de datos), aunque los dos lo añadan a la vez.
