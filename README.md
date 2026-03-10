# DIVA DRIVE

Repositorio base de DIVA DRIVE, una plataforma de movilidad urbana con foco en seguridad, conductoras mujeres y operacion empresarial controlable.

## Estado actual
Este repositorio inicia en Fase 0. La prioridad actual es consolidar la base documental, cerrar decisiones de arquitectura y preparar la estructura para desarrollo incremental.

## Estructura tecnica inicial
- `apps/api`: backend operacional con Fastify y TypeScript
- `apps/web`: panel web base con React y Vite
- `apps/mobile`: app movil Android-first con Expo y React Native
- `packages/domain`: contratos y tipos compartidos del dominio

## Comandos base
- `npm install`
- `npm run dev:api`
- `npm run dev:web`
- `npm run dev:mobile`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Documentos principales
- `PROJECT_OVERVIEW.md`
- `VISION_AND_SCOPE.md`
- `ARCHITECTURE_AND_EXECUTION_PLAN.md`
- `PRODUCT_SCOPE.md`
- `CODING_RULES.md`
- `TASK_TEMPLATE.md`
- `DEFINITION_OF_DONE.md`
- `docs/DOMAIN_MODEL.md`
- `docs/NON_FUNCTIONAL_REQUIREMENTS.md`
- `docs/OPERATIONS_AND_POLICIES.md`
- `docs/adrs/`

## Principios de arranque
- Android first
- open source por defecto
- mapa visible desde el primer viewport
- logica critica en backend
- negocio configurable, no hardcodeado
- tareas pequenas, verificables y versionables

## Siguiente paso recomendado
Implementar el primer slice vertical del producto: autenticacion base, home movil con mapa y el esqueleto de viajes apoyado en `packages/domain`.
