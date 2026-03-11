# DIVA DRIVE

Repositorio base de DIVA DRIVE, una plataforma de movilidad urbana con foco en seguridad, conductoras mujeres y operacion empresarial controlable.

## Estado actual
El repositorio ya supero la base documental inicial y hoy se encuentra en un **MVP operativo temprano**.

Actualmente existe un flujo funcional end-to-end para:

- autenticacion con Supabase Auth desde el API
- solicitud de viaje por pasajero
- aceptacion y avance manual del viaje por conductora
- tracking basico, historial, timeline e incidencias
- panel web operativo para supervision, directorio, pricing y promociones
- persistencia Supabase-first con fallback local para desarrollo
- realtime del API hacia `web` y `mobile`

Todavia no debe considerarse listo para produccion real. La prioridad actual es cerrar brechas del MVP, modularizar mejor el backend y endurecer la operacion.

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

## Slice actual
- autenticacion base de pasajero con endpoint demo en `apps/api`
- bootstrap inicial de home de pasajero desde backend
- home movil con mapa real como primer viewport
- contratos compartidos de sesion y home en `packages/domain`
- seleccion de destino sugerido, estimacion y solicitud inicial de viaje
- matching base temporal y tracking inicial del viaje en `requested`, `matched` y `driver_en_route`
- login por rol en mobile, cola de solicitudes para conductora y control manual de estados
- persistencia local de viajes en `apps/api/data/trips.json`
- panel web operativo consumiendo cola, activos y completados desde `api`
- incidencias persistidas en `apps/api/data/incidents.json`
- cancelaciones de viaje y visibilidad de incidencias/cancelados en panel
- panel web con login por `operator` o `admin` y endpoints `ops` protegidos
- cambio de estado de incidencias desde panel autenticado
- onboarding documental basico de conductoras con aprobacion administrativa
- directorio administrativo de conductoras y pasajeros en panel
- pricing configurable, promociones administrables y auditoria comercial
- historial de viajes, metricas comerciales, eventos operativos y notificaciones
- buscador de destinos, ruta simulada en mapa y ETA mas creible
- persistencia Supabase-first para usuarios, viajes, incidencias, eventos y reglas comerciales
- sesiones persistidas y lecturas live de viajes/eventos/incidencias desde el API

## Lo ya cubierto del MVP
- pasajero con mapa, origen/destino, estimacion, solicitud, historial e incidencias
- conductora con onboarding basico, cola de solicitudes, aceptacion y avance manual del viaje
- empresa con panel de viajes, incidencias, directorio, pricing, promociones y auditoria comercial
- contratos compartidos de dominio para estados, eventos, sesiones y reglas comerciales
- base realtime sobre WebSocket propio y bridge con Supabase Realtime

## Brechas actuales del MVP
- reglas reales por zona operativa
- ingresos basicos para conductora
- reserva/asignacion mas robusta para evitar competencia simultanea sobre una misma solicitud
- desacoplar totalmente el write-path restante del fallback local hacia persistencia live consistente
- observabilidad y pipeline CI antes de cualquier salida productiva

## Estado operativo real
Operativamente, la plataforma ya puede sostener un ciclo principal de servicio bajo supervision interna:

- pasajero autenticado puede estimar, solicitar, cancelar y seguir un viaje
- conductora aprobada puede ponerse `online`, recibir cola elegible, aceptar y avanzar estados
- solicitudes no tomadas expiran automaticamente
- la cola de conductora se prioriza por proximidad segun ultima ubicacion conocida
- existe una ventana corta de reserva para evitar que dos conductoras compitan por la misma solicitud al mismo tiempo
- operaciones puede intervenir sobre conductoras, incidencias, pricing, promociones y monitoreo

No esta lista todavia para una operacion comercial real en calle. Lo pendiente ya no es el flujo basico, sino endurecimiento operativo, reglas de zona, persistencia mas consistente y expansion de capacidades empresariales.

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
- `docs/SUPABASE_SETUP.md`
- `docs/sql/supabase_init.sql`

## Principios de arranque
- Android first
- open source por defecto
- mapa visible desde el primer viewport
- logica critica en backend
- negocio configurable, no hardcodeado
- tareas pequenas, verificables y versionables

## Siguiente paso recomendado
1. terminar de mover el write-path restante del API a repositorios live sobre Supabase
2. implementar reglas reales por zona operativa y elegibilidad geografica
3. agregar ingresos basicos y vista operativa para conductora
4. endurecer matching/reserva hacia una asignacion mas robusta
