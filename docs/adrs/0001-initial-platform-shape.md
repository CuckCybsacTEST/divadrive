# ADR 0001: Initial Platform Shape

## Estado
Aprobacion inicial pendiente de confirmacion humana.

## Contexto
El proyecto necesita una base tecnica suficientemente clara para arrancar Fase 0 sin sobredisenar una plataforma todavia no validada en operacion.

## Decision
Se adopta inicialmente:

- monorepo
- React Native para apps moviles
- React para panel web
- Node.js modular para backend
- PostgreSQL como base de datos principal
- compatibilidad operativa con Supabase cuando aporte velocidad de ejecucion

## Consecuencias
- se simplifica el desarrollo incremental con un solo repositorio
- se facilita reutilizar contratos, tipos y documentacion
- se evita entrar prematuramente en microservicios
- las decisiones de mapas, pagos y realtime premium quedan diferidas hasta tener datos de validacion o necesidad operativa
