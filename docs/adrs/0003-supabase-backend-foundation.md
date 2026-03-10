# ADR 0003 - Supabase Backend Foundation

## Estado
Accepted

## Contexto
La plataforma ya supero el punto en el que JSON locales son suficientes para seguir creciendo sin friccion. Ya existen viajes, promociones, eventos, incidencias, historial y reporting.

## Decision
Manteneremos el API propio como capa de negocio y conectaremos Supabase como infraestructura principal para:
- Postgres
- Auth
- Realtime
- Storage

`web` y `mobile` no accederan directamente a tablas privadas. El `service_role` vivira solo en el API.

## Consecuencias
- El backend gana una base real sin romper el dominio actual
- La migracion puede hacerse por fases
- Se necesita definir RLS antes de abrir auth real
- El siguiente paso tecnico es reemplazar los stores JSON por repositorios sobre Supabase
