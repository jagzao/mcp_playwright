#!/usr/bin/env node

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

console.log('🧪 Verificando modelos locales...\n');

async function testOllama() {
  console.log('1️⃣  Verificando Ollama...');

  try {
    const { stdout } = await execAsync('ollama list');
    const models = stdout.split('\n').slice(1).filter(line => line.trim());

    if (models.length === 0) {
      console.log('   ❌ No hay modelos instalados en Ollama');
      return false;
    }

    console.log('   ✅ Ollama funcionando');
    console.log('   📦 Modelos instalados:');
    models.forEach(model => {
      const name = model.split(/\s+/)[0];
      if (name) console.log(`      - ${name}`);
    });

    return true;
  } catch (error) {
    console.log('   ❌ Ollama no está corriendo o no está instalado');
    console.log('   💡 Ejecuta: npm run setup');
    return false;
  }
}

async function testQwen() {
  console.log('\n2️⃣  Probando Qwen2.5-Coder...');

  try {
    const response = await new Promise<string>((resolve, reject) => {
      const child = spawn('ollama', ['run', 'qwen2.5-coder:7b', 'Say only "Hello"']);

      let output = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Exit code: ${code}`));
        }
      });

      // Timeout after 30s
      setTimeout(() => {
        child.kill();
        reject(new Error('Timeout'));
      }, 30000);
    });

    console.log('   ✅ Qwen funcionando correctamente');
    return true;
  } catch (error: any) {
    console.log('   ❌ Error probando Qwen:', error.message);
    return false;
  }
}

async function testTesseract() {
  console.log('\n3️⃣  Verificando Tesseract OCR...');

  try {
    const { stdout } = await execAsync('tesseract --version');
    const version = stdout.split('\n')[0];
    console.log('   ✅ Tesseract instalado:', version);
    return true;
  } catch (error) {
    console.log('   ⚠️  Tesseract no encontrado');
    console.log('   💡 OCR local no estará disponible');
    return false;
  }
}

async function main() {
  const ollamaOk = await testOllama();

  if (!ollamaOk) {
    console.log('\n❌ Ollama no está configurado correctamente');
    console.log('💡 Ejecuta: npm run setup\n');
    process.exit(1);
  }

  const qwenOk = await testQwen();
  const tesseractOk = await testTesseract();

  console.log('\n' + '='.repeat(50));

  if (qwenOk && ollamaOk) {
    console.log('✅ ¡Todo funcionando correctamente!');
    console.log('\n🚀 Puedes empezar a usar el sistema:');
    console.log('   npm run agent "tu tarea aquí"');
    console.log('   npm run console');
  } else {
    console.log('⚠️  Algunos componentes tienen problemas');
    console.log('💡 Revisa los mensajes de error arriba');
  }

  console.log('='.repeat(50) + '\n');
}

main().catch(console.error);
