# Supabase Setup

Este proyecto ya tiene preparada la base para empezar a usar Supabase desde el API sin exponer llaves en `web` o `mobile`.

## Paso 1. Crear el proyecto
- En Supabase, crea un proyecto nuevo para `DIVA DRIVE`
- Elige la region mas cercana al lanzamiento inicial
- Guarda:
  - `Project URL`
  - `anon public key`
  - `service_role key`

## Paso 2. Configurar variables locales
- Copia [D:\DIVADRIVE\.env.example](D:/DIVADRIVE/.env.example) a `.env`
- Completa:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_DB_SCHEMA=public`
  - `SUPABASE_ENABLED=true`

## Paso 3. Crear el esquema
- Abre el SQL Editor de Supabase
- Ejecuta el contenido de [D:\DIVADRIVE\docs\sql\supabase_init.sql](D:/DIVADRIVE/docs/sql/supabase_init.sql)

## Paso 4. Verificar el cliente del API
- El API ya carga entorno desde [D:\DIVADRIVE\apps\api\src\env.ts](D:/DIVADRIVE/apps/api/src/env.ts)
- El cliente admin ya queda disponible en [D:\DIVADRIVE\apps\api\src\supabase.ts](D:/DIVADRIVE/apps/api/src/supabase.ts)
- Mientras `SUPABASE_ENABLED=false`, el sistema sigue usando persistencia local y no rompe desarrollo

## Paso 5. Siguiente migracion recomendada
1. Migrar `users`, `trips`, `incidents` y `events`
2. Migrar `business rules`
3. Reemplazar sesiones demo por `Supabase Auth`
4. Activar `Realtime` para timeline y panel

## Nota de seguridad
- `service_role key` solo debe usarse en el API
- `mobile` y `web` no deben hablar directo con tablas privadas
- RLS debe activarse antes de abrir auth real
