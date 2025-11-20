# 🤖 MCP Playwright Automation

**Sistema de automatización web autónoma con agentes basados en LLMs locales (Costo $0)**

Un sistema completo de automatización web que combina el Model Context Protocol (MCP) con Playwright y LLMs locales para crear un agente autónomo capaz de navegar, interactuar y automatizar tareas en la web usando lenguaje natural.

> **✨ ACTUALIZACIÓN FASE 3 (Nov 2025):**
> ✅ **5 Intents Pre-Planeados** para LinkedIn (login, profile, search, message, post)
> ✅ **Session Management** integrado con detección automática de login
> ✅ **Tracking de Métricas** LLM calls y cache hits en tiempo real
> ✅ **Análisis de Perfil Mejorado** con detección multilingüe
> ✅ **100% Tests Pasando** (11/11 unitarios)
> 📄 Ver [FASE_3_INTEGRACION_FINAL.md](FASE_3_INTEGRACION_FINAL.md) para detalles completos

---

## 📦 Instalación Completa

### Prerrequisitos
- **Node.js** >= 20.0.0 ([Descargar aquí](https://nodejs.org/))
- **16GB RAM** (mínimo 8GB para pruebas)
- **25GB espacio en disco** (para modelos LLM)
- **Git** para clonar el repositorio

### Paso 1: Clonar el Repositorio
```bash
git clone https://github.com/tu-usuario/mcp_playwright.git
cd mcp_playwright
```

### Paso 2: Instalar Dependencias
```bash
npm install
```

Este comando:
- ✅ Instala todas las dependencias de Node.js
- ✅ Ejecuta el post-install script automáticamente
- ✅ Crea directorios necesarios (data/, logs/, etc.)
- ✅ Instala Playwright y navegadores

### Paso 3: Configuración Inicial
```bash
npm run init
```

Este comando:
- ✅ Crea el archivo `.env` con una MASTER_KEY segura
- ✅ Configura variables de entorno
- ✅ Prepara directorios de datos

**Archivo `.env` generado:**
```bash
# Configuración de seguridad
MASTER_KEY=<clave-generada-automáticamente>

# Entorno
NODE_ENV=development

# LLM Endpoints (opcional, usa valores por defecto)
OLLAMA_ENDPOINT=http://localhost:11434
QWEN_ENDPOINT=http://localhost:8000

# Logs
LOG_LEVEL=info
```

### Paso 4: Instalar Modelos LLM Locales
```bash
npm run setup
```

Este comando instala (puede tardar 20-30 minutos):
- ✅ **Ollama** - Runtime para modelos locales
- ✅ **Qwen2.5-Coder 7B** (4GB) - LLM principal para tareas
- ✅ **DeepSeek-Coder 6.7B** (3.8GB) - Fallback para tareas complejas
- ✅ **CodeLlama 7B** (3.8GB) - Segundo fallback
- ✅ **Tesseract OCR** - Para extracción de texto de imágenes

**Opcional:** Para visión avanzada (requiere GPU recomendada):
```bash
ollama pull llava:7b  # 4.7GB
```

### Paso 5: Verificar Instalación
```bash
npm run diagnose
```

**Salida esperada:**
```
🔍 MCP Playwright - System Diagnostic

✅ Node.js version: v20.x.x
✅ npm installed
✅ Directories created
✅ .env file exists
✅ Ollama service running
✅ Qwen model available
✅ DeepSeek model available
✅ Playwright installed
✅ Tesseract OCR available

🎉 All checks passed! System ready to use.
```

### Paso 6: Compilar TypeScript
```bash
npm run build
```

✅ **¡Instalación completada!** El sistema está listo para usar.

---

## 🚀 Guía de Uso Rápido

### Opción 1: Modo Agente (Lenguaje Natural)

**Ejecutar tareas con instrucciones en texto:**

```bash
# Ejemplo básico: Navegar y hacer screenshot
npm run agent "Navega a google.com y toma un screenshot"

# Ejemplo con formulario
npm run agent "Entra a ejemplo.com/contacto y completa el formulario con nombre: Juan, email: juan@email.com"

# Ejemplo con búsqueda
npm run agent "Busca en Google 'mejores laptops 2024' y dame los primeros 5 resultados"
```

**Caso de uso real: LinkedIn**
```bash
# Paso 1: Guardar sesión de login (solo una vez)
npm run agent "Navega a linkedin.com, haz login y guarda la sesión como 'linkedin'"

# Paso 2: Usar la sesión guardada
npm run agent "Restaura la sesión 'linkedin', busca empleos de desarrollador Python remoto y aplica a los primeros 3"
```

**Con datos de Excel:**
```bash
# Crear Excel en data/form-data/clientes.xlsx con columnas:
# nombre | email | telefono | empresa

# Ejecutar
npm run agent "Completa el formulario en formulario.com/registro con los datos de clientes.xlsx, procesa todas las filas"
```

### Opción 2: Modo Record (Grabar Acciones)

**Graba tus acciones manualmente y reutilízalas:**

```bash
# 1. Iniciar grabación
npm run record https://ejemplo.com --name mi-workflow

# 2. Se abre el navegador con Playwright Inspector
# 3. Realiza las acciones manualmente (clicks, relleno de formularios, etc.)
# 4. Cierra el navegador cuando termines

# 5. La grabación se guarda en: recordings/manual/mi-workflow.spec.ts
```

### Opción 3: Modo Replay (Reproducir Grabaciones)

**Ejecuta grabaciones guardadas:**

```bash
# Reproducir una grabación
npm run replay recordings/manual/mi-workflow.spec.ts

# Reproducir con datos diferentes
npm run replay recordings/manual/form.spec.ts --data data/form-data/nuevos-clientes.xlsx
```

### Gestión de Sesiones

**Guardar sesiones de login para reutilizar:**

```bash
# Guardar sesión actual
npm run agent "Guarda la sesión actual como 'mi-sitio'"

# Listar sesiones guardadas
npm run agent "Lista todas las sesiones guardadas"

# Restaurar sesión
npm run agent "Restaura la sesión 'mi-sitio'"

# Eliminar sesión
npm run agent "Elimina la sesión 'mi-sitio'"
```

---

## 📋 Comandos Disponibles

### Comandos Principales
```bash
npm run agent "<instrucción>"     # Modo agente autónomo
npm run record <url>              # Grabar workflow manualmente
npm run replay <archivo>          # Reproducir grabación
```

### Comandos de Configuración
```bash
npm run init                      # Configuración inicial
npm run setup                     # Instalar modelos LLM
npm run diagnose                  # Verificar sistema
npm run build                     # Compilar TypeScript
```

### Comandos de Desarrollo
```bash
npm run dev                       # Modo desarrollo con watch
npm run test                      # Ejecutar tests
npm run typecheck                 # Verificar tipos TypeScript
```

### Docker (Producción)
```bash
# Iniciar todo el stack
docker-compose up -d

# Ver logs
docker-compose logs -f mcp-playwright

# Detener
docker-compose down
```

---

## 💡 Ejemplos de Uso Completos

### Ejemplo 1: Automatizar Aplicaciones a LinkedIn

```bash
# 1. Primera vez: Guardar sesión de LinkedIn
npm run agent "Navega a linkedin.com, haz login con mis credenciales y guarda la sesión como 'linkedin-auth'"

# 2. Crear archivo Excel con datos del CV
# data/form-data/mi-cv.xlsx:
# nombre      | telefono  | experiencia | skills
# Juan Pérez  | 555-0001  | 5 años     | Python, React, AWS

# 3. Aplicar a empleos automáticamente
npm run agent "Restaura sesión 'linkedin-auth', busca empleos de 'Senior Developer' con Easy Apply, aplica a los primeros 5 usando datos de mi-cv.xlsx"
```

### Ejemplo 2: Rellenar Formularios Masivamente

```bash
# 1. Grabar el proceso una vez
npm run record https://formulario.com/registro --name registro-clientes

# 2. Preparar datos en Excel
# data/form-data/clientes.xlsx con 100 filas

# 3. Procesar todas las filas
npm run agent "Usa la grabación registro-clientes.spec.ts con datos de clientes.xlsx, completa el formulario para cada fila"
```

### Ejemplo 3: Web Scraping e Investigación

```bash
# Extraer datos de productos
npm run agent "Busca en amazon.com 'laptop dell', extrae nombre, precio y rating de los primeros 20 resultados, guárdalos en data/results/laptops.xlsx"

# Monitorear precios
npm run agent "Revisa el precio del producto en amazon.com/dp/B08X123, si es menor a $500 mándame una notificación"
```

---

## ✨ Características Principales

### 🎯 **Modos de Operación**

1. **Modo Agente** - Instrucciones en lenguaje natural
   ```bash
   npm run agent "Navega a LinkedIn y aplica a 3 empleos de Python"
   ```

2. **Modo Record** - Graba tus acciones manualmente
   ```bash
   npm run record https://example.com
   ```

3. **Modo Replay** - Reproduce grabaciones
   ```bash
   npm run replay recordings/my-workflow.spec.ts
   ```

### 💰 **100% Gratuito**

- ✅ LLMs locales (Qwen, DeepSeek, CodeLlama)
- ✅ Vision local (LLaVA, Tesseract OCR)
- ✅ Sin APIs pagas
- ✅ Sin límites de uso
- ✅ Privacidad total (todo local)

### 🧠 **Inteligencia**

- ✅ Razonamiento autónomo (observe → think → act)
- ✅ Auto-corrección de errores
- ✅ Aprendizaje de patrones
- ✅ Cache inteligente (reduce 90% llamadas LLM)
- ✅ Fallback multi-LLM (Qwen → DeepSeek → CodeLlama)

### 📊 **Datos y Automatización**

- ✅ Lee datos de Excel/CSV/TXT/Markdown
- ✅ Auto-rellena formularios desde datos
- ✅ Mapeo inteligente de campos
- ✅ Procesa múltiples filas en batch

### 🛡️ **Robusto**

- ✅ Retry automático con backoff exponencial
- ✅ Circuit breaker para servicios
- ✅ Graceful degradation
- ✅ Encriptación de sesiones
- ✅ Anti-detección (comportamiento humano)
- ✅ Rate limiting por sitio

### 📈 **Observabilidad**

- ✅ Logging estructurado (Winston)
- ✅ Métricas en tiempo real
- ✅ Dashboard de consola
- ✅ Videos y screenshots de ejecuciones
- ✅ Tracing completo

## 🚀 Instalación Rápida

### Prerrequisitos

- Node.js >= 20.0.0
- 16GB RAM (mínimo 8GB)
- 25GB espacio en disco

### 1. Clonar repositorio

```bash
git clone <repo-url>
cd mcp_playwright
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env y configurar MASTER_KEY (32+ caracteres)
```

### 4. Instalar modelos locales

```bash
npm run setup
```

Este script instalará:
- Ollama
- qwen2.5-coder:7b (4GB)
- deepseek-coder:6.7b (3.8GB)
- codellama:7b (3.8GB)
- llava:7b (4.7GB) - opcional
- Tesseract OCR

### 5. Verificar instalación

```bash
npm run verify-models
```

## 📖 Uso

### Modo Agente (Lenguaje Natural)

```bash
# Ejemplo 1: LinkedIn
npm run agent "Entra a LinkedIn, busca empleos de desarrollador Python remoto y aplica a los primeros 3"

# Ejemplo 2: Formulario con datos de Excel
npm run agent "Completa el formulario en signup.com con datos de data/form-data/clientes.xlsx"

# Ejemplo 3: Investigación
npm run agent "Investiga los precios de laptops Dell en Amazon y guárdalos en Excel"
```

### Modo Record

```bash
# Iniciar grabación
npm run record https://example.com

# Haces las acciones manualmente en el navegador
# Al terminar, se genera: recordings/manual/ejemplo.spec.ts
```

### Modo Replay

```bash
# Reproducir grabación
npm run replay recordings/manual/ejemplo.spec.ts

# Con datos diferentes
npm run replay recordings/manual/form-fill.spec.ts --data data/form-data/clientes.xlsx
```

### Consola Interactiva

```bash
npm run console

# Interface interactiva con comandos:
# - Ejecutar tareas
# - Ver métricas en vivo
# - Gestionar sesiones
# - Ver historial
```

## ⚙️ Configuración

### LLMs (config/llm-config.json)

```json
{
  "llms": [
    {
      "name": "qwen",
      "priority": 1,
      "schedule": "always"  // Usar siempre
    },
    {
      "name": "deepseek",
      "priority": 2,
      "schedule": {
        "allowed": [{"start": "22:00", "end": "06:00"}]  // Solo de noche
      }
    }
  ]
}
```

### Control Horario

El sistema usa modelos ligeros de día y modelos pesados de noche:

- **Día (6am-10pm)**: Solo Qwen (ligero, no traba tu máquina)
- **Noche (10pm-6am)**: Todos los modelos disponibles

### Límites de Recursos (config/resource-limits.json)

```json
{
  "daytime": {
    "maxCpuPercent": 50,
    "maxRamGB": 6,
    "allowedModels": ["qwen"]
  },
  "nighttime": {
    "maxCpuPercent": 90,
    "maxRamGB": 16,
    "allowedModels": ["qwen", "deepseek", "codellama"]
  }
}
```

## 📂 Estructura del Proyecto

```
mcp_playwright/
├── mcp-server/           # Servidor MCP con tools Playwright
├── agent/                # Motor del agente autónomo (futuro)
├── console-client/       # Cliente CLI (futuro)
├── lib/                  # Librerías compartidas
│   ├── resilience/      # Retry, circuit breaker
│   ├── security/        # Encriptación, sanitización
│   ├── observability/   # Logging, métricas
│   └── utils/           # Utilidades
├── config/              # Archivos de configuración
├── data/                # Datos y sesiones
│   ├── sessions/        # Sesiones guardadas (encriptadas)
│   ├── form-data/       # Datos para formularios
│   ├── videos/          # Videos de ejecuciones
│   └── screenshots/     # Screenshots
├── recordings/          # Grabaciones (Playwright tests)
│   ├── manual/          # Grabaciones manuales
│   └── agent-generated/ # Generadas por el agente
└── scripts/             # Scripts de utilidad
```

## 🎯 Casos de Uso

### 1. Aplicar a Empleos en LinkedIn

```bash
# 1. Guardar sesión de LinkedIn (una vez)
npm run auth:save linkedin

# 2. Preparar datos en Excel
# data/form-data/cv-datos.xlsx:
# | nombre      | telefono  | cv_path           |
# | Juan Pérez  | 555-0001  | /data/cv-juan.pdf |

# 3. Ejecutar
npm run agent --session linkedin "Aplica a 5 empleos de Python con Easy Apply usando cv-datos.xlsx"
```

### 2. Rellenar Formularios Masivamente

```bash
# 1. Grabar el workflow una vez
npm run record https://formulario.com

# 2. Procesar 100 registros desde Excel
npm run agent "Usa la grabación form-fill.spec.ts con datos de clientes.xlsx y procesa todas las filas"
```

### 3. Investigación y Extracción de Datos

```bash
npm run agent "Investiga los 20 laptops más baratos en Amazon, extrae nombre, precio y specs, guárdalos en data/results/laptops.xlsx"
```

## 🔧 Comandos Útiles

```bash
# Desarrollo
npm run dev                    # Modo desarrollo con watch
npm run build                  # Compilar TypeScript
npm run typecheck              # Verificar tipos

# Testing
npm run test                   # Todos los tests
npm run test:unit              # Tests unitarios
npm run test:integration       # Tests de integración

# Mantenimiento
npm run backup:create          # Crear backup
npm run backup:restore <file>  # Restaurar backup
npm run monitor                # Monitorear recursos
npm run stats                  # Ver estadísticas
```

## 🛡️ Seguridad

### Sesiones Encriptadas

Todas las sesiones (cookies, localStorage) se guardan encriptadas con AES-256-GCM:

```bash
# Las sesiones se guardan automáticamente encriptadas
# Requiere MASTER_KEY en .env (32+ caracteres)
```

### Sanitización de Inputs

Todos los inputs se sanitizan para prevenir:
- XSS
- Command injection
- SQL injection
- Path traversal

### Rate Limiting

El sistema respeta rate limits por sitio para evitar baneos:

```json
{
  "linkedin.com": { "maxActionsPerHour": 10 },
  "amazon.com": { "maxActionsPerHour": 20 }
}
```

## 📊 Monitoreo

### Dashboard de Métricas

```bash
npm run monitor

# Output:
# ╔═══════════════════════════════════════════╗
# ║         📊 METRICS DASHBOARD             ║
# ╠═══════════════════════════════════════════╣
# ║ Tasks Completed:    47                    ║
# ║ Success Rate:       95.2%                 ║
# ║ Cache Hit Rate:     89.3%                 ║
# ║ LLM: qwen                                 ║
# ║ Cost: $0.00                               ║
# ╚═══════════════════════════════════════════╝
```

### Logs

Los logs se guardan en `logs/`:
- `combined.log` - Todos los logs
- `error.log` - Solo errores

## ⚠️ Limitaciones y Consideraciones

### Legales

- ✅ Uso personal: Generalmente OK
- ⚠️ Web scraping: Verifica ToS del sitio
- ❌ Spam/abuse: Prohibido

### Técnicas

- Algunos sitios detectan bots (el sistema incluye anti-detección)
- CAPTCHAs pueden requerir intervención manual
- Rate limits varían por sitio

## 🤝 Contribuir

Contribuciones son bienvenidas! Por favor:

1. Fork el repositorio
2. Crea una rama para tu feature
3. Haz tus cambios
4. Agrega tests
5. Envía un Pull Request

## 📄 Licencia

MIT License - Ver [LICENSE](LICENSE) para detalles

## 🙏 Créditos

- [Playwright](https://playwright.dev/) - Automatización web
- [Model Context Protocol](https://modelcontextprotocol.io/) - Por Anthropic
- [Ollama](https://ollama.ai/) - LLMs locales
- [Qwen](https://github.com/QwenLM/Qwen) - Por Alibaba Cloud
- [DeepSeek](https://www.deepseek.com/) - DeepSeek AI
- [LLaVA](https://llava-vl.github.io/) - Vision local

## 📞 Soporte

- 🐛 Issues: [GitHub Issues](https://github.com/...)
- 💬 Discusiones: [GitHub Discussions](https://github.com/...)
- 📧 Email: support@...

---

**⭐ Si te gusta este proyecto, dale una estrella en GitHub!**
