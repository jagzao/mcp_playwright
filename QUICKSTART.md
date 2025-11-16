# 🚀 Guía de Inicio Rápido

Esta guía te llevará de 0 a ejecutar tu primer agente autónomo en menos de 10 minutos.

## Paso 1: Instalación (5 minutos)

```bash
# 1. Clonar e instalar
git clone <repo-url>
cd mcp_playwright
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Edita .env y establece MASTER_KEY (32+ caracteres aleatorios)

# 3. Instalar modelos locales
npm run setup
# ⏱️ Esto descarga ~15GB, toma 5-10 minutos
```

## Paso 2: Verificar (1 minuto)

```bash
npm run verify-models
```

Deberías ver:
```
✅ ¡Todo funcionando correctamente!
```

## Paso 3: Tu Primera Automatización (2 minutos)

### Ejemplo 1: Navegación Simple

```bash
npm run agent "Navega a google.com y búscate 'Playwright automation'"
```

### Ejemplo 2: Extraer Datos

```bash
npm run agent "Navega a news.ycombinator.com y extrae los títulos de las primeras 10 noticias"
```

### Ejemplo 3: Grabar un Workflow

```bash
npm run record https://example.com

# En el navegador que se abre:
# 1. Haz las acciones que quieres automatizar
# 2. Cierra el navegador
# 3. El workflow se guarda automáticamente
```

## Paso 4: Explorar Funciones Avanzadas

### Con Datos de Excel

1. Crea `data/form-data/test.xlsx` con columnas: nombre, email
2. Ejecuta:
```bash
npm run agent "Rellena el formulario en httpbin.org/forms/post con datos de test.xlsx"
```

### Modo Consola Interactivo

```bash
npm run console
```

Tendrás una interfaz interactiva para:
- Ejecutar tareas
- Ver métricas en vivo
- Gestionar sesiones
- Ver historial

## Próximos Pasos

- 📖 Lee el [README completo](README.md)
- 🎯 Revisa [ejemplos avanzados](docs/examples.md)
- ⚙️ Configura [LLMs](config/llm-config.json)
- 🔒 Aprende sobre [seguridad](docs/security.md)

## Solución de Problemas

### Error: "Ollama no está corriendo"
```bash
ollama serve &
```

### Error: "Model not found"
```bash
npm run setup  # Re-instalar modelos
```

### El agente va muy lento
- Es normal en el primer uso (descarga de modelos)
- Usa cache después de la primera ejecución
- De día solo usa Qwen (ligero)

## Ayuda

- 🐛 [Reportar bug](https://github.com/.../issues)
- 💬 [Preguntas](https://github.com/.../discussions)
- 📧 Contacto: support@...

¡Disfruta la automatización con costo $0! 🎉
