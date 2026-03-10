# ARCHITECTURE_AND_EXECUTION_PLAN.md

## Principio rector
DIVA DRIVE sera construido como una plataforma modular, con base open source y preparada para produccion, utilizando un enfoque de desarrollo principalmente ejecutado por un unico agente principal de IA, bajo supervision humana continua.

## Arquitectura conceptual
### Componentes principales
- app movil de pasajero
- app movil de conductora
- backend operacional
- panel administrativo y de empresa
- consola operativa / soporte
- motor de reglas comerciales
- sistema de tracking y estados de viaje

### Dominios base del sistema
- identidad y acceso
- usuarios y perfiles
- conductoras
- pasajeros
- viajes
- geolocalizacion y mapas
- precios
- promociones
- recompensas
- soporte e incidencias
- reportes y metricas

## Enfoque tecnologico general
La arquitectura priorizara herramientas open source donde sean suficientes y dejara la integracion de servicios pagos para casos donde aporten valor claro.

### Linea tecnica inicial acordada
- monorepo para apps, backend y panel
- frontend movil con React Native y enfoque Android first
- panel web con React
- backend con Node.js y arquitectura modular
- PostgreSQL como base principal
- compatibilidad con Supabase para autenticacion, storage y Postgres administrado si conviene
- mensajeria realtime mediante canales websocket o equivalente compatible con el stack
- despliegues modernos en infraestructura tipo Vercel, Railway o equivalente
- mapas y geolocalizacion con enfoque open source, dejando posibilidad de integrar proveedores premium cuando corresponda
- observabilidad con logs estructurados, metricas y trazas desde la primera version operativa

## Principios de arquitectura
1. **Modularidad antes que improvisacion.**
2. **Separacion clara entre frontend, operacion y negocio.**
3. **Logica critica fuera del cliente.**
4. **Reglas comerciales desacopladas del codigo de interfaz.**
5. **Preparacion para crecer sin rehacer la base.**
6. **Open source por defecto, pago solo donde el retorno tecnico/operativo lo justifique.**

## Requisito especial: flexibilidad comercial
El sistema debe disenarse desde el inicio para soportar:

- descuentos
- recompensas
- promociones
- bonos
- campanas
- cambios de tarifa
- reglas por zona, horario o condicion

Esto implica evitar que estas reglas queden embebidas de forma rigida en la app o duplicadas en multiples capas.

## Modelo operativo obligatorio
Antes de construir el flujo de viajes se debe respetar un modelo comun de estados, eventos y permisos. Ese contrato vive en `docs/DOMAIN_MODEL.md` y debe ser la referencia compartida entre backend, apps y panel.

## Enfoque de construccion
El proyecto tendra dos planes simultaneos:

### A. Plan de producto
Define que se construye.

### B. Plan de ejecucion
Define como se construye con el agente principal.

Ambos planos son obligatorios.

## Estrategia de ejecucion con agente unico
El proyecto se desarrollara principalmente con un agente unico de IA. Este agente no opera con autonomia libre; opera dentro de un marco estricto de trabajo.

### Principios de ejecucion del agente
- una tarea a la vez
- alcance limitado y explicito
- contexto localizado
- cambios controlados
- respeto por arquitectura y contratos existentes
- documentacion continua
- validacion tecnica obligatoria

### Riesgos a controlar
- perdida de contexto
- cambios demasiado amplios
- rotura de modulos ajenos
- duplicacion de logica
- desorden arquitectonico
- desviacion del alcance pedido

### Reglas operativas del agente
- no redisenar arquitectura sin respaldo documental
- no modificar contratos publicos sin registrar el cambio
- no tocar archivos no relacionados con la tarea
- mantener consistencia con los documentos maestros
- dejar trazabilidad de lo implementado
- asumir de forma conservadora cuando falte contexto
- validar con lint, test y build antes de cerrar tareas

## Requisitos documentales del repositorio
Para que el agente unico opere correctamente, el proyecto debera mantener documentacion base viva.

### Documentos maestros minimos
- PROJECT_OVERVIEW.md
- VISION_AND_SCOPE.md
- ARCHITECTURE_AND_EXECUTION_PLAN.md

### Documentos complementarios esperados
- README.md
- CONTRIBUTING.md
- PRODUCT_SCOPE.md
- CODING_RULES.md
- TASK_TEMPLATE.md
- DEFINITION_OF_DONE.md
- docs/DOMAIN_MODEL.md
- docs/NON_FUNCTIONAL_REQUIREMENTS.md
- docs/OPERATIONS_AND_POLICIES.md
- docs/adrs/

## Estrategia de repositorio
El repositorio debera organizarse para facilitar:

- desarrollo paso a paso
- formacion interna del equipo
- claridad de contexto para el agente
- evolucion controlada del sistema

## Forma de trabajo
El proyecto se implementara en fases y tareas pequenas. No se trabajara con ordenes difusas como "construye toda la app", sino con entregables delimitados, verificables y versionables.

### Ejemplos de tamano correcto de tarea
- crear base de autenticacion de pasajero
- implementar home con mapa full screen
- crear entidad y tabla de conductoras
- implementar flujo basico de solicitud de viaje
- crear dashboard inicial de viajes activos
- incorporar motor base para reglas de descuento

## Supervision humana
Aunque el agente principal ejecute gran parte del desarrollo, la supervision humana sigue siendo obligatoria para:

- definir prioridades
- aprobar arquitectura
- validar alcance
- revisar cambios criticos
- autorizar merges relevantes

## Fases iniciales sugeridas
### Fase 0 - Base del proyecto
- definicion documental
- estructura del repositorio
- convenciones y reglas
- stack definitivo
- entornos iniciales

### Fase 1 - Nucleo movil y de acceso
- autenticacion
- perfil base
- mapa en home
- geolocalizacion

### Fase 2 - Nucleo operacional
- solicitud de viaje
- matching base
- tracking y estados
- panel operativo inicial

### Fase 3 - Negocio y control
- promociones
- descuentos
- recompensas
- metricas
- dashboards empresariales

### Fase 4 - Seguridad y expansion
- funciones de seguridad reforzada
- precios avanzados
- mejoras operativas
- automatizaciones adicionales

## Declaracion final
DIVA DRIVE sera construido como una plataforma real de movilidad, con identidad clara, arquitectura modular, base open source y preparacion para produccion, mediante un flujo de desarrollo guiado principalmente por un unico agente principal de IA y supervision humana continua.
