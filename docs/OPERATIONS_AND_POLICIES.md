# OPERATIONS_AND_POLICIES.md

## Objetivo
Definir politicas operativas minimas que impactan el producto y la implementacion.

## Onboarding de conductoras
- toda conductora debe pasar validacion documental antes de operar
- el estado de habilitacion debe ser visible para empresa y backend
- una conductora no habilitada no puede quedar online ni recibir viajes

## Zonas operativas
- la empresa define zonas habilitadas
- el sistema debe poder restringir solicitud o asignacion fuera de zona
- esta politica sigue pendiente de implementacion operativa real en el codigo

## Incidencias
- pasajero, conductora y empresa pueden registrar incidencias
- cada incidencia debe guardar tipo, severidad, viaje asociado y estado de resolucion
- incidencias criticas deben quedar visibles en panel operativo

## Seguridad operacional
- las funciones de SOS, PIN y compartir viaje pueden salir despues del MVP, pero el modelo debe dejar espacio para agregarlas sin romper el ciclo del viaje
- desvio de ruta e hitos de seguridad deben modelarse como eventos auditables

## Cancelaciones
- deben existir causales configurables
- la empresa puede intervenir en cancelaciones excepcionales
- las reglas comerciales o penalidades no pueden quedar hardcodeadas en clientes

## Estado operativo actual
- una conductora no aprobada no puede ponerse `online`
- una conductora `offline` no puede aceptar viajes
- una solicitud no atendida expira automaticamente dentro de la ventana operativa actual
- la cola visible para conductoras se prioriza por proximidad y aplica una reserva temporal para reducir competencia simultanea
- las reglas de zona y politicas avanzadas de asignacion siguen pendientes antes de cualquier salida productiva

## Privacidad y datos sensibles
- la documentacion de conductoras debe almacenarse de forma segura
- la ubicacion en tiempo real debe tener acceso controlado
- soporte y operaciones solo deben ver los datos necesarios segun rol

## Cumplimiento
- antes de salida productiva se debe validar la normativa aplicable de la ciudad y pais de lanzamiento
- cualquier restriccion legal que afecte onboarding, operacion o retencion de datos debe convertirse en politica documentada
