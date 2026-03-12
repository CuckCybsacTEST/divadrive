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
- Si ya lo ejecutaste antes, vuelve a correrlo: ahora incluye helpers, policies RLS y alta de tablas en `supabase_realtime` para WebSocket live

## Paso 4. Verificar el cliente del API
- El API ya carga entorno desde [D:\DIVADRIVE\apps\api\src\env.ts](D:/DIVADRIVE/apps/api/src/env.ts)
- El cliente admin ya queda disponible en [D:\DIVADRIVE\apps\api\src\supabase.ts](D:/DIVADRIVE/apps/api/src/supabase.ts)
- Mientras `SUPABASE_ENABLED=false`, el sistema sigue usando persistencia local y no rompe desarrollo

## Paso 5. Preparar roles de Auth
- El API crea usuarios en Supabase Auth con `app_metadata.role`
- Roles esperados:
  - `passenger`
  - `driver`
  - `operator`
  - `admin`
- Los perfiles de negocio quedan separados por tipo:
  - `passenger_profiles`
  - `driver_profiles` con aprobacion, estado operativo y notas de revision
  - `internal_user_profiles` para `operator/admin`
- El SQL usa ese `role` para RLS mediante `current_app_role()` e `is_ops_role()`
- `service_role` sigue viviendo solo en el API y bypassa RLS para la capa de negocio

## Paso 6. Validar auth real
- Crea al menos una cuenta `passenger`, una `driver` y una `operator` o `admin`
- Inicia sesion desde `mobile` y `web`
- Verifica que `/auth/session` responda con `email`, `role` y el `id` de Supabase Auth
- Verifica que el panel solo abra con `operator` o `admin`

## Paso 7. Validar Realtime externo
- Asegurate de re-ejecutar [D:\DIVADRIVE\docs\sql\supabase_init.sql](D:/DIVADRIVE/docs/sql/supabase_init.sql) despues de esta fase
- Ese SQL ahora agrega `passenger_profiles`, `driver_profiles`, `trips`, `trip_incidents`, `trip_events`, `business_config`, `promotions` y `business_audit_log` a la publicacion `supabase_realtime`
- Tambien agrega `internal_user_profiles` para que el panel vea altas/cambios de operadores y admins
- Sin eso, el API puede emitir WebSocket por cambios propios, pero no podra reemitir cambios hechos directo en Supabase
- Despues de correrlo, prueba un `update` externo sobre `promotions` o `trips` y confirma que `web/mobile` reaccionen sin polling

## Paso 8. Siguiente migracion recomendada
1. Consolidar `auth` menos demo sobre Supabase Auth
2. Mover mas writes del API a repositorios live sobre Supabase
3. Activar `Realtime` para timeline y panel
4. Subir documentos de conductoras a Supabase Storage

## Nota de seguridad
- `service_role key` solo debe usarse en el API
- `mobile` y `web` no deben hablar directo con tablas privadas
- RLS ya queda preparado en el SQL, pero debes re-ejecutarlo en tu proyecto Supabase
