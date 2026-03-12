# NON_FUNCTIONAL_REQUIREMENTS.md

## Objetivo
Definir criterios minimos no funcionales para evitar una base tecnica ambigua.

## Seguridad
- autenticacion obligatoria para apps y panel
- autorizacion por roles en backend
- datos sensibles protegidos en transito y en reposo
- trazabilidad de acciones administrativas
- gestion segura de secretos y credenciales

## Observabilidad
- logs estructurados en backend
- correlacion de eventos por identificador de viaje
- metricas basicas de solicitudes, viajes y errores
- monitoreo de errores para apps y backend

## Rendimiento inicial
- respuesta de APIs criticas en tiempos razonables bajo carga inicial esperada
- propagacion de cambios de estado del viaje con latencia apta para operacion en tiempo real
- actualizacion de tracking suficientemente frecuente para seguimiento operativo

## Disponibilidad y resiliencia
- manejo de errores sin perdida silenciosa de estados
- reintentos controlados en integraciones externas
- backups regulares de base de datos
- capacidad de restauracion validable

## Calidad
- lint habilitado
- pruebas automatizadas progresivas
- entornos separados al menos para desarrollo y produccion
- pipeline de integracion continua antes de salida productiva
- contratos compartidos alineados entre `domain`, `api`, `web` y `mobile` mediante typecheck de workspace

## Privacidad
- retencion de datos definida por politica
- acceso minimizado a datos personales
- tratamiento controlado de ubicacion y documentacion
