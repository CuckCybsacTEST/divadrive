# ADR 0002: Monorepo Foundation

## Estado
Aprobacion inicial pendiente de confirmacion humana.

## Contexto
La Fase 0 necesita una base tecnica comun que permita evolucionar apps y backend sin duplicar contratos ni perder trazabilidad.

## Decision
Se establece una base de monorepo con:

- `apps/api` para backend operacional
- `apps/web` para panel web y futuras herramientas internas
- `apps/mobile` para la app Android-first
- `packages/domain` para contratos y tipos compartidos
- npm workspaces como gestor inicial del repositorio
- TypeScript como lenguaje comun

## Consecuencias
- el proyecto puede crecer por capas sin romper la cohesion documental
- backend, web y mobile comparten un mismo contrato base del dominio
- se deja margen para introducir mas paquetes compartidos cuando aparezcan necesidades reales
