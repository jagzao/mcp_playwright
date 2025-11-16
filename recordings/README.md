# 📹 Recordings

Esta carpeta contiene grabaciones de Playwright en formato `.spec.ts` que pueden ser:

## Tipos de Grabaciones

### 1. Manual (manual/)
Grabaciones creadas manualmente usando el modo record:
```bash
npm run record https://example.com
```

### 2. Agent-Generated (agent-generated/)
Grabaciones generadas automáticamente por el agente cuando completa tareas.

## Uso

### Reproducir una grabación
```bash
npm run replay recordings/manual/mi-workflow.spec.ts
```

### Usar con Playwright nativo
```bash
npx playwright test recordings/manual/mi-workflow.spec.ts
```

### Copiar a proyecto de testing
Las grabaciones son tests de Playwright 100% compatibles:
```bash
cp recordings/manual/*.spec.ts ../mi-proyecto/tests/
```

## Estructura de una Grabación

```typescript
import { test, expect } from '@playwright/test';

test.describe('Mi Workflow', () => {
  test('Descripción de la tarea', async ({ page }) => {
    // Las acciones del workflow...
    await page.goto('https://example.com');
    await page.click('#button');
    // ...
  });
});
```
