# CONTRIBUTING.md

## Objetivo
Mantener un ritmo de desarrollo ordenado, trazable y compatible con trabajo asistido por IA bajo supervision humana.

## Reglas de contribucion
- cada cambio debe responder a una tarea concreta y acotada
- no mezclar refactors grandes con funcionalidad nueva
- respetar contratos documentados antes de introducir codigo
- registrar decisiones de arquitectura en `docs/adrs/`
- actualizar documentacion cuando cambie alcance, comportamiento o contratos
- validar lint, test y build cuando el proyecto ya tenga esas herramientas disponibles

## Antes de abrir cambios
- confirmar que la tarea existe y tiene alcance explicito
- revisar documentos maestros y documentos de dominio afectados
- identificar riesgos operativos, de seguridad y de compatibilidad

## Al cerrar cambios
- dejar evidencia de validacion
- documentar supuestos relevantes
- anotar deuda tecnica si fue aceptada conscientemente
