---
name: project-lead
description: >-
  Mini-orchestrator for the Browser Agent Gateway. Takes the active User Story from analysis
  through implementation, tests, browser-engine fallback validation, independent review and
  a single final status. Use when the user says /project-lead, asks the agent to implement a
  browser-gateway story end-to-end, or delegates the MVP without prescribing individual steps.
metadata:
  version: "1.0"
  language: es
---

# Skill: Project Lead — Browser Agent Gateway

Punto de entrada para implementar una actividad de punta a punta. El Project Lead debe evolucionar el stack existente; no crear un framework paralelo.

## Fase 0 — Discovery

1. Leer `AGENTS.md`.
2. Leer `.agents/session/current_task.md` si existe.
3. Leer la US activa en `docs/user-stories/`.
4. Leer `docs/architecture/browser-gateway.md` y ADRs relacionados.
5. Inspeccionar implementación y tests existentes antes de proponer archivos nuevos.
6. Confirmar rama actual. No trabajar directamente sobre la rama default para cambios de código.

## Fase 1 — Plan contra Acceptance Criteria

Crear un plan corto que mapee cada slice a AC concretos. Decisiones técnicas reversibles se toman y documentan; solo detenerse por una decisión de producto/seguridad realmente no inferible o por secretos necesarios.

Prioridad de implementación para US-001:

1. contratos/tipos;
2. fallback policy determinista;
3. adaptar Playwright existente;
4. adapter Obscura;
5. sesiones;
6. safety approval gate;
7. LLM router configurable;
8. telemetría/costo;
9. integración MCP/CLI;
10. smoke + integration tests.

## Fase 2 — Implementación

Implementar vertical slices pequeños. Después de cada slice:

- agregar/actualizar tests;
- ejecutar el conjunto mínimo relevante;
- corregir antes de seguir;
- no duplicar capacidades existentes.

No hardcodear modelos ni proveedores en dominio. No mezclar routing de engine con routing de LLM.

## Fase 3 — Validación real

Para cambios del browser gateway se exige demostrar:

- path Obscura-first;
- fallback forzado a Playwright;
- final `manual_escalation_required` cuando ambos motores fallan;
- aislamiento de sesiones;
- safety gate bloqueando side-effects sin aprobación;
- telemetría sin secretos.

Siempre ejecutar al final:

```bash
npm run typecheck
npm run test:unit
npm run build
```

Y las pruebas de integración/E2E relevantes.

## Fase 4 — Revisión independiente

Pedir revisión en contexto fresco si hay agente/reviewer disponible. Revisar específicamente:

- bypass de safety por fallback;
- filtración de cookies/API keys en logs;
- SSRF/private-network access;
- loops infinitos de retry/fallback;
- acoplamiento a un modelo concreto;
- reimplementación innecesaria de Playwright;
- claims de compatibilidad Obscura no probados.

Blocker/high vuelve a implementación y revalidación.

## Fase 5 — Estado único

Usar solo uno:

- `done`: AC con evidencia + gates verdes + sin blocker/high.
- `blocked`: falta secreto/decisión humana imprescindible.
- `failed`: se agotaron intentos razonables y existe diagnóstico.

El reporte final debe incluir AC, módulos cambiados, comandos/resultados, fallbacks probados, findings de seguridad, métricas/costos disponibles, limitaciones y siguiente US sugerida.

## Reglas de oro

1. Continuar automáticamente entre fases; no pedir permiso para tests/build/refactors reversibles.
2. Side-effects externos reales requieren aprobación humana.
3. No bajar seguridad para hacer funcionar un sitio.
4. Obscura es default; Playwright es fallback de compatibilidad, no deuda a eliminar en el MVP.
5. Codex Browser es escalación externa/manual; este gateway no debe simular que puede invocarlo.
6. Structured DOM/snapshot antes de screenshot cuando sea suficiente.
7. Nunca declarar `done` solo porque compila.
