---
name: project-lead
description: >-
  Mini-orchestrator for the Browser Agent Gateway. Executes the active deliver from discovery
  through implementation, exhaustive validation, usability proof, fallback/recovery checks,
  independent review and a single final state. Use when the user says /project-lead, asks the
  agent to implement the Browser Gateway usable V1 end-to-end, or delegates a deliver without
  prescribing individual steps.
metadata:
  version: "1.2"
  language: es
---

# Skill: Project Lead — Browser Agent Gateway

Punto de entrada para implementar el proyecto de punta a punta. El objetivo actual no es solo terminar una abstracción o US parcial: es alcanzar el **Usable V1** definido por la Master Agent Memory y la US activa.

## Fase 0 — Discovery obligatoria

1. Leer `AGENTS.md` completo.
2. Leer `.agents/session/current_task.md`.
3. Leer **`.agents/memory/browser-gateway-master-spec.md` completo**. Este archivo es el mega-prompt persistente/autoritativo.
4. Leer la US activa completa; para el release actual es `docs/user-stories/US-004-browser-gateway-usable-v1.md`.
5. Leer todos los docs/ADR referenciados por la US/Master Spec: browser gateway, persistent lifecycle, auth/secrets, deep research, context routing, WebMCP strategy y decisiones relacionadas.
6. Leer las historias/componentes anteriores (US-001/Issue #1, US-002/Issue #2, US-003/Issue #3) como sub-scope/evidencia, no como límites que permitan detener el release umbrella prematuramente.
7. Inspeccionar implementación, tests, CI, scripts, README y problemas existentes antes de crear nuevas capas.
8. Confirmar rama actual. No trabajar directamente sobre rama default para cambios de código.
9. Identificar blockers ya conocidos de la Master Spec (CI/lockfile, logging/secret leakage, singleton Playwright lifecycle, etc.) y comprobar su estado real antes de asumir que siguen o ya fueron resueltos.

No pedir al dueño que repita el análisis. Git contiene el contexto.

## Fase 1 — Plan maestro contra Acceptance Criteria

Crear un plan corto pero completo, ordenado por dependencias, que mapee cada slice a AC concretos y a evidencia esperada.

Para cada AC definir:

- slice/código responsable;
- test(s) que lo demostrarán;
- failure/fallback/recovery path relevante;
- seguridad/observabilidad requerida;
- riesgo de regresión y cobertura;
- si requiere una dependencia humana real o puede simularse/automatizarse.

Orden recomendado para US-004:

1. baseline reproducible + CI + redaction/security blockers;
2. completar/verificar Browser Gateway core / US-001;
3. BrowserHost persistente + human takeover;
4. SecretProvider + SessionVault / US-002;
5. Deep Research + SearchProviderRouter + Evidence Ledger / US-003;
6. MCP/CLI/setup/diagnostics/README para producto usable;
7. WebMCP readiness/feature boundary sin bloquear core V1;
8. full validation matrix;
9. independent review;
10. operational usability smoke.

Decisiones técnicas reversibles se toman y documentan. Solo detenerse por una decisión de producto/seguridad realmente no inferible o una dependencia humana/external imprescindible.

## Fase 2 — Implementación incremental y continua

Implementar vertical slices pequeños. Después de cada slice:

- agregar/actualizar tests;
- ejecutar el conjunto mínimo relevante;
- corregir antes de seguir;
- preservar backward compatibility salvo decisión explícita;
- no duplicar capacidades existentes;
- registrar decisiones durables en docs/ADR/memory;
- actualizar estados/evidencia si el repo tiene tracking de workflow.

No hardcodear modelos/proveedores en dominio. No mezclar routing de browser engine, LLM, search provider ni secret provider.

### Regla crítica del umbrella deliver

No detenerse porque un sub-scope quedó verde.

Por ejemplo:

- terminar US-001 != terminar US-004;
- tener SessionVault sin pause/resume != usable;
- tener tests verdes sin README/diagnose/smoke operativo != usable;
- compilar != usable.

Continuar automáticamente al siguiente bloque de US-004 mientras no exista un bloqueo exclusivamente humano.

## Fase 3 — Browser lifecycle / Human-in-the-loop

El BrowserHost debe ser independiente del lifetime del turno LLM/MCP.

Cuando aparezca login/MFA/CAPTCHA/user takeover:

1. promover/pin a headed Playwright si corresponde;
2. cambiar actividad a `WAITING_FOR_USER`;
3. mantener navegador/context/page vivos;
4. persistir metadata suficiente para reanudar;
5. devolver `blocked`/waiting solo si realmente se requiere a Juan, con una instrucción concreta;
6. **no cerrar navegador al devolver control**;
7. cuando Juan diga `continúa`, identificar y reanudar la actividad correcta sin pedirle que repita el objetivo;
8. después del login, persistir auth cifrada cuando la política lo permita;
9. continuar el resto de la US automáticamente.

No fingir que una pestaña live sobrevivió si el proceso BrowserHost realmente murió; detectar y usar recovery/reauth state tipado.

## Fase 4 — Matriz de validación obligatoria

No existe un único tipo de prueba suficiente. Ejecutar toda categoría aplicable al deliver:

1. **UT** — reglas puras, políticas, routers, state machines, redaction, safety, budgets/ranking.
2. **Integration/contract** — adapters, MCP/CLI, engines, BrowserHost, SessionVault, SecretProvider, SearchProvider, telemetry.
3. **E2E** — flujo real extremo a extremo desde interfaz usada por agente hasta resultado observable.
4. **Smoke** — escenarios repetibles de arranque/capacidad principal.
5. **Regression** — funcionalidad existente crítica/tocada permanece verde.
6. **Security/abuse** — secretos/logs, SSRF/private network, prompt injection/tool escalation, approval bypass, session isolation, invalid input, endpoint exposure.
7. **Failure/fallback/recovery** — engine/provider failure, timeout, retry bounded, Playwright fallback, manual escalation, lost host, expired/malformed session, budget exhaustion.
8. **Persistence/lifecycle** — restart/reconnect/TTL/revocation; distinguir durable auth de live-browser lifetime.
9. **Human-in-the-loop** — demostrar `WAITING_FOR_USER -> RESUME` conservando misma sesión/página mientras BrowserHost siga vivo y sin cerrar durante espera.
10. **Performance/cost/observability** — no loops sin límite; latencia/fallback/cost per successful task donde aplique.
11. **Independent review** — contexto fresco.

Para US-004 demostrar como mínimo:

- Obscura-first real o mediante entorno de integración válido;
- fallback forzado a Playwright;
- ambos engines fallan -> `manual_escalation_required`;
- Playwright headed persistent takeover;
- BrowserHost no ligado a turn lifetime;
- session isolation;
- auth persistence/restart/revocation;
- safety gate sin bypass por fallback;
- prompt injection fixture sin escalation;
- SSRF/private targets blocked;
- deep research evidence/citations/budgets/contradictions;
- telemetry sin secretos;
- CLI/MCP usable;
- diagnose/health;
- clean-user smoke según README.

Si una categoría es genuinamente N/A, reportar razón concreta.

Siempre ejecutar al final los gates del repo y cualquier suite adicional requerida por la US.

## Fase 5 — Loop de autocorrección hasta cierre real

Si cualquier AC/test/smoke/E2E/regresión/seguridad/usabilidad/revisión falla:

1. capturar evidencia y síntoma;
2. reproducir determinísticamente cuando sea posible;
3. formular causa/hipótesis;
4. aplicar el fix mínimo correcto;
5. rerun de la prueba afectada;
6. rerun de pruebas vecinas/regresión del área;
7. continuar al siguiente gate solo cuando quede verde.

Repetir mientras exista progreso verificable. El tiempo, tokens o número de iteraciones no permiten declarar `done` ni abandonar.

No pedir permiso para:

- tests;
- build/typecheck/lint;
- refactors reversibles;
- crear fakes/fixtures;
- levantar servicios locales de test;
- avanzar al siguiente slice;
- rerun de validaciones;
- corregir findings blocker/high.

## Fase 6 — Revisión independiente

Pedir revisión en contexto fresco si hay agente/reviewer disponible. Revisar específicamente:

- bypass de safety por fallback;
- filtración de cookies/API keys/form values en logs o tool results;
- SSRF/private-network access;
- prompt injection cambiando permisos/routing/secrets;
- loops infinitos de retry/fallback/research;
- acoplamiento a proveedor/modelo;
- reimplementación innecesaria de Playwright;
- claims Obscura/WebMCP no probados;
- cierre accidental del navegador en `WAITING_FOR_USER`;
- confusión entre live session y durable auth;
- falta de session isolation;
- falta de usable CLI/MCP/docs pese a tests verdes;
- ausencia de regression/E2E/smoke/security aplicables.

Blocker/high vuelve a implementación + matriz de validación. Medium se corrige si es razonable dentro de US-004 o se documenta como deuda explícita aceptada; nunca ocultarlo.

## Fase 7 — Usability gate

Antes de declarar `done`, ejecutar un flujo como un consumidor nuevo:

1. seguir README/Quickstart;
2. ejecutar setup/diagnose;
3. comprobar health/capabilities;
4. ejecutar public browse smoke;
5. ejecutar forced fallback smoke;
6. ejecutar wait/resume smoke;
7. validar session persistence/reuse;
8. ejecutar research smoke;
9. revisar telemetría/resultados;
10. comprobar que los comandos/instrucciones son suficientes sin leer implementación interna.

Si el proyecto solo es usable por quien escribió el código, no está `done`.

## Fase 8 — Estado final único

Usar exactamente uno:

- `done`: US-004 y Master Spec con AC/evidencia + matriz completa aplicable verde + usability gate verde + revisión sin blocker/high.
- `blocked`: falta secreto, MFA/user takeover, decisión humana o dependencia externa imprescindible; estado/BrowserHost/artefactos necesarios para reanudar quedan preservados cuando sea seguro/posible.
- `failed`: ciclos de diagnóstico/fix ya no producen progreso medible y existe evidencia clara de la causa.

El reporte final debe incluir:

- AC -> evidencia;
- módulos cambiados;
- comandos/resultados;
- UT/integration/E2E/smoke/regression/security/failure/persistence/HITL ejecutados;
- fallbacks/recovery probados;
- findings de seguridad;
- métricas/costos disponibles;
- usability proof;
- limitaciones/deuda explícita;
- handoff requerido a OrquestadorZao/Interview Nail/Marketing;
- estado final único.

Después de `done`, queda listo para auditoría independiente Juan + ChatGPT.

## Reglas de oro

1. Leer Master Agent Memory antes de actuar; no pedir un mega-prompt al dueño.
2. Continuar automáticamente entre fases/sub-stories del umbrella deliver.
3. Side-effects externos reales requieren aprobación humana según política.
4. No bajar seguridad para hacer funcionar un sitio.
5. Obscura es default para navegación machine-driven; Playwright es fallback de compatibilidad y path obligatorio para user takeover visible cuando corresponde.
6. `WAITING_FOR_USER` pausa actividad, no destruye BrowserHost.
7. `continúa` debe reanudar la actividad/sesión correcta sin reexplicar contexto.
8. Codex Browser es escalación externa/manual; el gateway no simula que puede invocarlo.
9. Structured DOM/snapshot antes de screenshot cuando sea suficiente.
10. Nunca declarar `done` solo porque compila, una suite parcial está verde o una sub-US terminó.
11. La instrucción normal del dueño debe bastar:
    `Ejecuta /project-lead sobre la tarea activa. Lee la Master Agent Memory y llévala de inicio a fin hasta done/blocked/failed.`
