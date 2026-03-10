# CODING_RULES.md

## Principios
- modularidad sobre atajos
- contratos explicitos antes que inferencias
- logica de negocio en backend
- configuracion por datos antes que hardcode
- cambios pequenos y verificables

## Reglas operativas
- no duplicar reglas de negocio entre apps y backend
- no introducir estados de viaje sin actualizar el modelo de dominio
- no consumir APIs internas sin contrato tipado o documentado
- no agregar dependencias sin justificar su necesidad
- no esconder errores criticos; usar manejo de errores y logging estructurado

## Documentacion obligatoria
- si cambia alcance, actualizar `PRODUCT_SCOPE.md`
- si cambia arquitectura, crear o modificar un ADR
- si cambia el ciclo del viaje o politicas de operacion, actualizar `docs/DOMAIN_MODEL.md` o `docs/OPERATIONS_AND_POLICIES.md`

## Calidad minima
- lint limpio
- pruebas en la capa modificada cuando existan
- build valido cuando aplique
- notas de supuestos y limitaciones
