export class InputSanitizer {
  // Prevenir injection attacks
  sanitizeForShell(input: string): string {
    // Remover caracteres peligrosos
    return input.replace(/[;&|`$(){}[\]<>]/g, '');
  }

  sanitizeForSQL(input: string): string {
    return input.replace(/['";\\]/g, '');
  }

  sanitizeForXSS(input: string): string {
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  // Validar URLs
  validateURL(url: string): boolean {
    try {
      const parsed = new URL(url);
      // Solo permitir http/https
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  // Validar selectores CSS (prevenir injection)
  validateSelector(selector: string): boolean {
    // No permitir selectores que puedan ejecutar código
    const dangerous = [
      'javascript:',
      'data:',
      'vbscript:',
      'expression(',
      'import(',
    ];

    const lowerSelector = selector.toLowerCase();
    return !dangerous.some(d => lowerSelector.includes(d));
  }

  // Sanitizar nombre de archivo
  sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}

export const sanitizer = new InputSanitizer();
