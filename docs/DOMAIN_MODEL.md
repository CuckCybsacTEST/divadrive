# DOMAIN_MODEL.md

## Objetivo
Definir el contrato operativo minimo compartido entre apps, backend y panel.

## Roles principales
- pasajero
- conductora
- operador empresa
- administrador empresa

## Entidades base
- `Passenger`
- `Driver`
- `Vehicle`
- `Trip`
- `TripRequest`
- `LocationSnapshot`
- `FareRule`
- `Promotion`
- `Incident`
- `AuditEvent`

## Ciclo de vida del viaje
Estados iniciales obligatorios de `Trip`:

1. `draft`
2. `requested`
3. `matched`
4. `driver_en_route`
5. `driver_arrived`
6. `trip_started`
7. `trip_completed`
8. `cancelled`
9. `expired`

## Reglas de transicion
- un viaje pasa a `requested` cuando el pasajero confirma origen, destino y solicitud
- un viaje pasa a `matched` cuando una conductora acepta la solicitud
- un viaje pasa a `driver_en_route` cuando la conductora confirma desplazamiento hacia origen
- un viaje pasa a `driver_arrived` cuando la conductora marca llegada
- un viaje pasa a `trip_started` cuando se cumple la validacion de inicio definida para la operacion
- un viaje pasa a `trip_completed` cuando la conductora finaliza el servicio
- un viaje pasa a `cancelled` cuando pasajero, conductora o empresa lo cancelan bajo una causal
- un viaje pasa a `expired` cuando no fue asignado dentro del tiempo operativo configurado

## Eventos obligatorios
- `trip_requested`
- `trip_matched`
- `driver_assigned`
- `driver_arrived`
- `trip_started`
- `trip_completed`
- `trip_cancelled`
- `trip_expired`
- `incident_created`

## Responsabilidades por rol
### Pasajero
- crear solicitud
- ver estado del viaje
- cancelar segun politica
- reportar incidencia

### Conductora
- aceptar o rechazar solicitud
- marcar llegada
- iniciar viaje
- finalizar viaje
- reportar incidencia

### Empresa
- monitorear viajes activos
- intervenir ante incidencias
- cancelar administrativamente cuando sea necesario
- auditar eventos

## Cancelaciones
Toda cancelacion debe guardar:

- actor que cancela
- motivo
- timestamp
- estado previo
- si aplica penalidad o bloqueo de regla comercial

## Matching base
El matching inicial debe considerar como minimo:

- conductora online
- conductora habilitada
- proximidad a origen
- ausencia de viaje activo incompatible
- zona operativa permitida

## Estado operativo implementado
Actualmente el dominio implementado ya cubre:

- estado `online/offline` de conductora
- ultima ubicacion conocida de conductora para priorizacion operativa
- expiracion de solicitudes en `requested`
- reserva temporal de solicitud para una conductora especifica antes de aceptacion definitiva

Todavia no esta completamente implementado:

- validacion real por zona operativa
- rechazo/filtrado por politicas geograficas duras
- asignacion automatica mas fuerte que la cola reservada actual

## Auditoria
Todo cambio de estado y toda accion administrativa relevante debe generar `AuditEvent`.
