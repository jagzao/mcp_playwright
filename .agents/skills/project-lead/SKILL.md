---
name: project-lead
description: >-
  Mini-orchestrator for the Browser Agent Gateway. Takes the active User Story from analysis
  through implementation, exhaustive validation, fallback/recovery checks, independent review
  and a single final state. Use when the user says /project-lead, asks the agent to implement a
  story end-to-end, or delegates a deliver without prescribing individual steps.
metadata:
  version: "1.1"
  language: es
---

# Skill: Project Lead — Browser Agent Gateway

Punto de entrada para implementar una actividad de punta a punta. El Project Lead debe evolucionar el stack existente; no crear un framework paralelo.

## Fase 0 — Discovery

1. Leer `AGENTS.md`.
2. Leer `.agents/session/current_task.md` si existe.
3. Leer la US activa en `docs/user-stories/` completa.
4. Leer todos los docs/ADR referenciados por esa US; no asumir que el último mensaje contiene todo el alcance.
5. Inspeccionar implementación, tests e incidentes existentes antes de proponer archivos nuevos.
6. Confirmar rama actual. No trabajar directamente sobre la rama default para cambios de código.
7. Si la US fue generada como resultado de un análisis amplio, tratarla como la fuente consolidada y completa del deliver; no re-reducir alcance por conveniencia.

## Fase 1 — Plan contra Acceptance Criteria

Crear un plan corto que mapee cada slice a AC concretos y a su evidencia esperada. Decisiones técnicas reversibles se toman y documentan; solo detenerse por una decisión de producto/seguridad realmente no inferible o por secretos/interacción humana imprescindibles.

Para cada AC definir antes de implementar:

- código/slice responsable;
- prueba(s) que lo demostrarán;
- failure/fallback path relevante;
- observabilidad/evidencia requerida;
- riesgo de regresión y qué prueba existente/nueva lo cubre.

## Fase 2 — Implementación incremental

Implementar vertical slices pequeños. Después de cada slice:

- agregar/actualizar tests;
- ejecutar el conjunto mínimo relevante;
- corregir antes de seguir;
- no duplicar capacidades existentes;
- registrar decisiones durables en docs/ADR/memory cuando corresponda.

No hardcodear modelos ni proveedores en dominio. No mezclar routing de engine con routing de LLM.

## Fase 3 — Matriz de validación obligatoria

No existe un único tipo de prueba suficiente. Ejecutar toda categoría aplicable al cambio:

1. **UT** — reglas puras, políticas, routers, state machines, redaction, safety.
2. **Integration/contract** — adapters, MCP, engines, SessionVault, SecretProvider, search providers, storage.
3. **E2E** — flujo real extremo a extremo desde la interfaz usada por el agente hasta resultado observable.
4. **Smoke** — escenario mínimo repetible que demuestra que el sistema arranca y la capacidad principal funciona.
5. **Regression** — funcionalidad existente crítica/tocada debe permanecer verde; no limitarse a tests nuevos.
6. **Security** — secretos/logs, SSRF/private network, prompt injection/tool escalation, permission/safety bypass, session isolation.
7. **Failure/fallback/recovery** — engine/provider failure, timeout, retry bounded, Playwright fallback, manual escalation, restart/recovery.
8. **Persistence/lifecycle** — cuando aplique, demostrar restart/reconnect/TTL/revocation y que el estado esperado sobrevive o expira correctamente.
9. **Human-in-the-loop** — cuando aplique, demostrar `WAITING_FOR_USER -> RESUME` conservando la misma sesión/pestaña/browser host sin cerrar el navegador durante la espera.

Para Browser Gateway, además demostrar explícitamente cuando aplique:

- path Obscura-first;
- fallback forzado a Playwright;
- actividad pinned a Playwright headed si requiere login/MFA/CAPTCHA/user takeover;
- final `manual_escalation_required` cuando los motores controlados no pueden completar;
- aislamiento de sesiones;
- safety gate bloqueando side-effects sin aprobación;
- telemetría sin secretos;
- BrowserHost persistente no ligado al lifetime de un turno LLM.

Siempre ejecutar al final los gates del repo y cualquier suite adicional requerida por la US.

## Fase 4 — Loop de autocorrección hasta cierre real

Si cualquier test, AC, smoke, E2E, regresión, seguridad o revisión falla:

1. capturar evidencia y síntoma;
2. reproducir de forma determinista cuando sea posible;
3. formular causa/hipótesis;
4. aplicar el fix mínimo correcto;
5. rerun de la prueba afectada;
6. rerun de pruebas vecinas/regresión del área;
7. continuar al siguiente gate solo cuando quede verde.

Repetir el loop cuanto sea necesario mientras exista progreso verificable. El tiempo transcurrido o el número de iteraciones no permite declarar `done`. Si se llega a un bloqueo exclusivamente humano, persistir el estado y devolver `blocked` sin destruir sesiones/artefactos necesarios para continuar.

## Fase 5 — Revisión independiente

Pedir revisión en contexto fresco si hay agente/reviewer disponible. Revisar específicamente:

- bypass de safety por fallback;
- filtración de cookies/API keys en logs;
- SSRF/private-network access;
- prompt injection cambiando permisos/routing/secrets;
- loops infinitos de retry/fallback;
- acoplamiento a un modelo concreto;
- reimplementación innecesaria de Playwright;
- claims de compatibilidad Obscura/WebMCP no probados;
- cierre accidental del navegador durante `WAITING_FOR_USER`;
- ausencia de regresión/E2E/smoke pese a que aplicaban.

Blocker/high vuelve a implementación + matriz de validación. Medium se corrige si es razonable dentro de la US o se documenta explícitamente como deuda aceptada; nunca ocultarlo.

## Fase 6 — Estado único

Usar solo uno:

- `done`: todos los AC aplicables con evidencia + matriz de pruebas aplicable verde + build/gates verdes + revisión sin blocker/high.
- `blocked`: falta secreto, MFA/user takeover, decisión humana o dependencia externa imprescindible; estado persistido para reanudar.
- `failed`: no hay progreso razonable tras ciclos de diagnóstico/fix y existe evidencia clara de la causa.

El reporte final debe incluir:

- AC -> evidencia;
- módulos cambiados;
- comandos/resultados;
- UT/integration/E2E/smoke/regression/security ejecutados;
- fallbacks/recovery probados;
- findings de seguridad;
- métricas/costos disponibles;
- limitaciones/deuda explícita;
- estado final único.

Después de `done`, el trabajo queda listo para auditoría independiente de Juan/ChatGPT; el Project Lead no debe pedir que vuelvan a explicarle la US.

## Reglas de oro

1. Continuar automáticamente entre fases; no pedir permiso para tests/build/refactors reversibles.
2. Side-effects externos reales requieren aprobación humana según política.
3. No bajar seguridad para hacer funcionar un sitio.
4. Obscura es default para navegación machine-driven; Playwright es fallback de compatibilidad y el path obligatorio para user takeover visible cuando corresponda.
5. Un estado `WAITING_FOR_USER` pausa la actividad, no destruye el BrowserHost; al recibir "continúa" debe reanudar la actividad/sesión correcta.
6. Codex Browser es escalación externa/manual; este gateway no debe simular que puede invocarlo.
7. Structured DOM/snapshot antes de screenshot cuando sea suficiente.
8. Nunca declarar `done` solo porque compila o porque una suite parcial está verde.
9. Cuando la US ya contiene el análisis consolidado, no pedir un mega-prompt al dueño. La instrucción normal de arranque debe bastar: `Ejecuta /project-lead sobre la US activa y llévala de inicio a fin.`
