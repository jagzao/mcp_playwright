#!/bin/bash

set -e

echo "🚀 Instalando modelos locales para MCP Playwright Automation..."
echo ""

# Check if running on supported OS
if [[ "$OSTYPE" != "linux-gnu"* ]] && [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ Este script solo soporta Linux y macOS"
    exit 1
fi

# 1. Install Ollama
echo "📦 Instalando Ollama..."
if ! command -v ollama &> /dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
    echo "✅ Ollama instalado"
else
    echo "✅ Ollama ya está instalado"
fi

# Start Ollama service (if not running)
if ! pgrep -x "ollama" > /dev/null; then
    echo "🔄 Iniciando servicio Ollama..."
    ollama serve > /dev/null 2>&1 &
    sleep 3
fi

# 2. Download coding models
echo ""
echo "📥 Descargando modelos de código (esto puede tardar varios minutos)..."

echo "  📥 Descargando qwen2.5-coder:7b (~4GB)..."
ollama pull qwen2.5-coder:7b

echo "  📥 Descargando deepseek-coder:6.7b (~3.8GB)..."
ollama pull deepseek-coder:6.7b

echo "  📥 Descargando codellama:7b (~3.8GB)..."
ollama pull codellama:7b

# 3. Download vision model (optional)
echo ""
read -p "¿Deseas instalar el modelo de vision LLaVA (~4.7GB)? (s/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[SsYy]$ ]]; then
    echo "  📥 Descargando llava:7b (~4.7GB)..."
    ollama pull llava:7b
    echo "✅ LLaVA instalado"
else
    echo "⏭️  Saltando instalación de LLaVA"
fi

# 4. Install Tesseract OCR
echo ""
echo "📦 Instalando Tesseract OCR..."

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    if command -v apt-get &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng
    elif command -v yum &> /dev/null; then
        sudo yum install -y tesseract tesseract-langpack-spa tesseract-langpack-eng
    else
        echo "⚠️  No se pudo instalar Tesseract automáticamente. Instálalo manualmente."
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    if command -v brew &> /dev/null; then
        brew install tesseract tesseract-lang
    else
        echo "⚠️  Homebrew no encontrado. Instala Tesseract manualmente."
    fi
fi

if command -v tesseract &> /dev/null; then
    echo "✅ Tesseract instalado"
else
    echo "⚠️  Tesseract no instalado. Algunas funciones de OCR no estarán disponibles."
fi

# 5. Verify installations
echo ""
echo "🔍 Verificando instalaciones..."
echo ""

ollama list

echo ""
echo "✅ ¡Instalación completada!"
echo ""
echo "📊 Resumen:"
echo "  ✅ qwen2.5-coder:7b - Modelo principal (rápido)"
echo "  ✅ deepseek-coder:6.7b - Backup nocturno"
echo "  ✅ codellama:7b - Fallback"
if ollama list | grep -q "llava"; then
    echo "  ✅ llava:7b - Vision (opcional)"
fi
if command -v tesseract &> /dev/null; then
    echo "  ✅ Tesseract OCR"
fi

echo ""
echo "💾 Espacio usado en disco: ~20-25GB"
echo ""
echo "🎉 Todo listo! Ahora puedes ejecutar:"
echo "   npm run verify-models    # Verificar que todo funcione"
echo "   npm run agent \"tu tarea\"  # Ejecutar el agente"
echo ""
