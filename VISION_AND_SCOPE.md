# VISION_AND_SCOPE.md

## Vision del producto
Construir una plataforma de movilidad segura, escalable y comercialmente flexible, con identidad propia y foco en conductoras mujeres, capaz de ofrecer una experiencia confiable para pasajeros y una operacion controlable para la empresa.

## Vision operacional
La plataforma debe permitir gestionar viajes en tiempo real con un modelo operativo claro, trazable y medible, evitando dependencia excesiva de logica improvisada en frontend o reglas dispersas en distintos componentes.

## Vision tecnica
El sistema debe nacer con una arquitectura moderna y modular, priorizando open source y dejando preparados los puntos donde, si es necesario, se integraran servicios pagos para mejorar precision, escalabilidad o experiencia.

## Objetivos del producto
### Objetivos de negocio
- lanzar una solucion de movilidad con diferencial claro
- permitir operacion formal y controlada
- habilitar campanas, promociones y reglas comerciales sin rehacer la base tecnica
- preparar la plataforma para crecimiento progresivo

### Objetivos de experiencia
- mapa visible desde el inicio
- flujo simple para solicitar viajes
- seguimiento claro del estado del servicio
- experiencia de seguridad reforzada
- uso claro y comodo para conductoras

### Objetivos tecnicos
- modularidad
- mantenibilidad
- escalabilidad
- observabilidad
- flexibilidad de integracion
- facilidad de evolucion del producto

## Alcance funcional inicial
### A. App de pasajero
Debe contemplar como base:

- autenticacion
- mapa principal
- geolocalizacion
- seleccion de origen y destino
- estimacion de viaje
- solicitud de viaje
- seguimiento en vivo
- historial
- perfil
- promociones y recompensas
- soporte y seguridad

### B. App de conductora
Debe contemplar como base:

- autenticacion
- mapa principal
- estado online/offline
- recepcion de solicitudes
- gestion de viaje
- navegacion operativa
- ingresos y bonos
- perfil y documentacion
- soporte y seguridad

### C. Panel empresa
Debe contemplar como base:

- dashboard general
- viajes activos
- gestion de conductoras
- gestion de pasajeros
- incidencias
- precios y reglas
- campanas y promociones
- metricas y reportes
- soporte operativo
- auditoria

## Alcance funcional ampliado
El sistema debe quedar preparado para soportar posteriormente:

- precios dinamicos
- incentivos por zona
- recompensas por frecuencia
- promociones programadas
- cupones
- referidos
- viajes programados
- perfiles o categorias de servicio
- analitica avanzada
- automatizaciones comerciales

## Seguridad y confianza
La seguridad es una dimension funcional y no un accesorio. La plataforma debe quedar preparada para incorporar capacidades como:

- boton SOS
- PIN de inicio de viaje
- compartir viaje en tiempo real
- monitoreo de incidencias
- alertas por desvio de ruta
- controles especificos por zona y horario

## Alcance tecnico acordado
Se trabajara con una solucion compuesta por:

- aplicaciones moviles
- backend operacional
- paneles web
- motor de reglas de negocio/comerciales
- infraestructura de despliegue moderna

## Fuera de alcance inmediato
En la fase inicial no se prioriza:

- complejidad innecesaria de microservicios extremos
- dependencia total de proveedores pagos desde el dia uno
- automatizaciones comerciales avanzadas no esenciales para la base
- expansion multiplataforma excesiva antes de consolidar Android
- multiples ciudades o paises antes de estabilizar la primera operacion

## Criterios rectores de alcance
1. Resolver primero el nucleo operativo.
2. Disenar desde el inicio la flexibilidad comercial.
3. Evitar hardcodear precios, promociones o incentivos.
4. Mantener una arquitectura lista para produccion sin sobredimensionar prematuramente.
5. Avanzar por etapas claras y versionables.

## Alcance del MVP v1
El MVP v1 debe permitir operar viajes reales en una ciudad con supervision interna.

Incluye:

- registro e inicio de sesion
- validacion basica de perfil
- mapa principal para pasajero y conductora
- solicitud de viaje inmediata
- matching base por proximidad y disponibilidad
- ciclo de viaje con estados definidos
- tracking basico en vivo
- cancelaciones controladas
- historial basico
- panel web con viajes activos, conductoras, pasajeros e incidencias
- configuracion de tarifa base y promociones simples

No incluye en v1:

- viajes programados
- pricing dinamico avanzado
- referidos
- programas complejos de recompensas
- automatizaciones comerciales
- multiples categorias de servicio
- integraciones financieras avanzadas

## Criterio de salida del MVP v1
El MVP v1 se considera listo cuando:

- un pasajero puede solicitar un viaje extremo a extremo
- una conductora puede aceptar, iniciar y finalizar un viaje
- la empresa puede observar viajes activos e incidencias
- los precios base se configuran desde backend/panel
- los eventos criticos quedan auditados
- la plataforma pasa criterios minimos de seguridad, logs, pruebas y despliegue definidos por el repositorio
