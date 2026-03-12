# PROJECT_OVERVIEW.md

## Nombre del proyecto
**DIVA DRIVE**

## Tipo de producto
Plataforma de movilidad urbana con enfoque en seguridad, confianza y operacion profesional, donde las conductoras son exclusivamente mujeres y los pasajeros pueden ser hombres o mujeres.

## Estado del proyecto
Proyecto real en fase de **MVP operativo temprano**. La base documental inicial ya fue superada por una implementacion funcional de backend, app movil y panel web, aunque todavia no esta lista para salida productiva formal.

## Naturaleza del proyecto
DIVA DRIVE no se plantea como una demo ni como un clon basico de aplicacion de taxis. Se plantea como una plataforma completa, escalable y preparada para produccion, compuesta por aplicaciones moviles, backend operacional, paneles administrativos y modulos flexibles de negocio.

## Objetivo general
Disenar, construir y evolucionar una plataforma de movilidad moderna que permita:

- solicitar y gestionar viajes en tiempo real
- operar con geolocalizacion y mapas
- ofrecer experiencia diferenciada para pasajeros y conductoras
- administrar el negocio desde paneles empresariales
- soportar descuentos, recompensas, promociones y reglas comerciales sin rigidez tecnica
- crecer desde una base open source hacia una operacion productiva formal

## Usuarios del sistema
### Pasajeros
Personas que solicitan viajes desde la app movil.

### Conductoras
Mujeres conductoras autorizadas dentro de la plataforma.

### Empresa
Equipo interno encargado de operacion, soporte, metricas, campanas, control comercial y supervision del servicio.

## Propuesta de valor
DIVA DRIVE ofrece una propuesta diferenciada basada en:

- red de conductoras mujeres
- foco en seguridad y confianza
- experiencia de movilidad clara y moderna
- gestion operativa profesional
- estructura comercial flexible

## Alcance funcional macro
La plataforma incluira:

- aplicacion movil para pasajeros
- aplicacion movil para conductoras
- backend de operacion
- panel administrativo/empresa
- consola operativa y de soporte
- motor de reglas comerciales
- sistema de seguimiento de viajes y estados
- base para promociones, recompensas, campanas y pricing flexible

## Principios estrategicos
1. **Android first.**
2. **Open source siempre que sea razonable.**
3. **Preparacion para produccion desde el diseno inicial.**
4. **Arquitectura modular y escalable.**
5. **Flexibilidad comercial como requisito nativo.**
6. **Desarrollo principalmente asistido por un agente unico de IA bajo supervision humana.**

## Requisito de experiencia clave
La aplicacion movil debe mostrar el mapa en el primer viewport del flujo principal.

## Contexto de lanzamiento inicial
Para evitar ambiguedad al arrancar, se asumen estas definiciones iniciales hasta que un ADR o decision de negocio las cambie:

- lanzamiento inicial en una sola ciudad
- un solo pais en la primera version operativa
- una moneda principal
- idioma principal espanol
- operacion en zonas urbanas delimitadas
- pricing base configurable por panel, no hardcodeado

## Resultado esperado
Una base de software real, mantenible y ampliable, apta para ser construida paso a paso en repositorio versionado y utilizada tanto como proyecto productivo como material de formacion tecnica interna.

## Estado operativo actual
Actualmente el repositorio ya ofrece:

- autenticacion y sesiones desde backend
- fallback local de autenticacion para desarrollo cuando Supabase no esta disponible
- flujo principal de viaje extremo a extremo bajo supervision
- onboarding y aprobacion operativa de conductoras
- bloqueo/reactivacion operativa de conductoras con nota de revision
- cambio `online/offline` de conductora solo para conductoras aprobadas y activas
- expiracion automatica de solicitudes no atendidas
- cola de solicitudes priorizada por proximidad
- reserva temporal de solicitudes para reducir competencia simultanea
- zonas operativas configurables con restriccion real de solicitud y aceptacion
- ingresos basicos de conductora con payout configurable desde operaciones
- gestion administrativa de usuarios internos `operator/admin`
- panel operativo con viajes, incidencias, directorio, pricing y promociones

Las brechas principales ya no estan en el esqueleto del producto, sino en endurecimiento operativo: asignacion mas fuerte, persistencia plenamente consistente, observabilidad y expansion de controles operativos.
