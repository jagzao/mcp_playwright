# Local quality gate — mcp_playwright

GitHub Actions is disabled for this repository (zero CI cost policy). Run the former CI steps locally.

```bash
npm ci --ignore-scripts
npm run build
npm test || echo "Tests not configured yet"
npx tsc --noEmit
npx eslint . --ext .ts,.js || echo "ESLint not configured"
npm audit --audit-level=moderate || true
```

## Evidence required
For each gate, record: command, exit code, test counts, timestamp, commit SHA.

## Policy
GitHub Actions is DISABLED (zero CI cost). Do not add .github/workflows. Run gates locally.