# PRODUCT_SCOPE.md

## Objetivo
Traducir la vision general en alcance ejecutable para el MVP v1.

## Supuestos iniciales
- una sola ciudad de lanzamiento
- una sola operacion empresarial centralizada
- idioma principal espanol
- moneda principal unica
- operacion Android first

## Capacidades incluidas en MVP v1
### Pasajero
- autenticacion
- mapa home
- origen y destino
- estimacion
- solicitud de viaje inmediata
- tracking basico
- historial basico
- perfil basico
- soporte basico

### Conductora
- autenticacion
- onboarding documental basico
- aprobacion operativa y bloqueo/reactivacion administrativa
- cambio online/offline
- recepcion y aceptacion de solicitud
- inicio y finalizacion de viaje
- soporte basico

### Empresa
- login administrativo
- vista de viajes activos
- vista de conductoras y pasajeros
- vista y gestion de usuarios internos
- configuracion de tarifa base
- promociones simples
- gestion de incidencias
- auditoria basica

## Capacidades post-MVP
- viajes programados
- pricing dinamico
- motor avanzado de incentivos
- referidos
- categorias de servicio
- automatizaciones comerciales
- analitica avanzada

## Restricciones del MVP
- sin multi-ciudad
- sin multinmoneda
- sin red compleja de microservicios
- sin dependencia obligatoria de proveedores premium

## Preguntas que deben resolverse antes de produccion
- ciudad y pais exactos de lanzamiento
- proveedor o estrategia de pagos
- politica legal y regulatoria aplicable
- requerimientos de verificacion de conductoras
- esquema de comision empresarial

## Estado actual frente al MVP
Ya implementado en codigo:

- pasajero: autenticacion, mapa home, estimacion, solicitud, tracking basico, historial e incidencias
- conductora: autenticacion, onboarding/aprobacion, cambio online/offline, bloqueo/reactivacion operativa, cola de solicitudes, aceptacion y avance manual del viaje
- empresa: login administrativo, dashboard operativo, directorio, incidencias, pricing, promociones, auditoria comercial y gestion basica de usuarios internos
- matching operativo inicial: disponibilidad de conductora, priorizacion por proximidad, expiracion de solicitudes, reserva temporal de cola y elegibilidad por zona operativa
- lectura economica inicial de conductora: ingresos brutos, fee plataforma, neto estimado y viajes completados/cancelados
- payout de conductora configurable desde pricing operativo
- fallback local de auth y perfiles para desarrollo sin depender de Supabase

Pendiente para considerar el MVP mas completo:

- onboarding estructurado de conductoras con checklist documental y estados mas finos
- gestion administrativa mas completa para conductoras y usuarios internos
- una asignacion/reserva todavia mas robusta para escenarios de concurrencia real
- comision, bonos e ingresos mas detallados para conductora
- endurecimiento de persistencia, observabilidad y politicas previas a produccion
