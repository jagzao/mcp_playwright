import ExcelJS from 'exceljs';
import { readFileSync } from 'fs';
import { marked } from 'marked';
import { logger } from '../../../../lib/observability/logger.js';

export const dataTools = [
  {
    name: 'data_read_excel',
    description: 'Read data from Excel file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to Excel file' },
        sheet: { type: 'string', description: 'Sheet name (optional)' },
        range: { type: 'string', description: 'Range to read, e.g., "A1:D10" (optional)' },
      },
      required: ['path'],
    },
    async execute(args: any) {
      const { path, sheet, range } = args;

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(path);

      const worksheet = sheet
        ? workbook.getWorksheet(sheet)
        : workbook.worksheets[0];

      if (!worksheet) {
        throw new Error('Worksheet not found');
      }

      const data: any[] = [];
      const headers: string[] = [];

      // Get headers from first row
      const firstRow = worksheet.getRow(1);
      firstRow.eachCell((cell, colNumber) => {
        headers[colNumber - 1] = cell.text;
      });

      // Get data rows
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header row

        const rowData: any = {};
        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber - 1];
          rowData[header] = cell.text;
        });

        data.push(rowData);
      });

      return {
        success: true,
        path,
        sheet: worksheet.name,
        headers,
        rowCount: data.length,
        data,
      };
    },
  },

  {
    name: 'data_read_text',
    description: 'Read text from file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to text file' },
      },
      required: ['path'],
    },
    async execute(args: any) {
      const { path } = args;

      const content = readFileSync(path, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      return {
        success: true,
        path,
        content,
        lineCount: lines.length,
        lines,
      };
    },
  },

  {
    name: 'data_read_markdown',
    description: 'Read and parse Markdown file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to Markdown file' },
      },
      required: ['path'],
    },
    async execute(args: any) {
      const { path } = args;

      const content = readFileSync(path, 'utf-8');
      const html = await marked(content);

      // Extract sections
      const sections = content.split(/^#{1,6}\s+/gm).filter(s => s.trim());

      return {
        success: true,
        path,
        content,
        html,
        sectionCount: sections.length,
        sections,
      };
    },
  },

  {
    name: 'data_map_to_form',
    description: 'Map data fields to form fields intelligently',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'object', description: 'Data object with fields' },
        formFields: {
          type: 'array',
          items: { type: 'object' },
          description: 'Form fields from page',
        },
      },
      required: ['data', 'formFields'],
    },
    async execute(args: any) {
      const { data, formFields } = args;

      const mapping: any = {};

      // Smart mapping logic
      for (const field of formFields) {
        const fieldName = (field.name || field.id || field.label || '').toLowerCase();

        // Try to find matching data field
        for (const [key, value] of Object.entries(data)) {
          const dataKey = key.toLowerCase();

          if (
            fieldName.includes(dataKey) ||
            dataKey.includes(fieldName) ||
            this.isSimilar(fieldName, dataKey)
          ) {
            mapping[field.name || field.id] = value;
            break;
          }
        }
      }

      return {
        success: true,
        mapping,
        mappedCount: Object.keys(mapping).length,
      };
    },

    isSimilar(a: string, b: string): boolean {
      // Simple similarity check
      const commonPatterns: { [key: string]: string[] } = {
        email: ['email', 'mail', 'e-mail', 'correo'],
        phone: ['phone', 'tel', 'telephone', 'telefono', 'celular'],
        name: ['name', 'nombre', 'fullname'],
        firstname: ['firstname', 'first', 'nombre'],
        lastname: ['lastname', 'last', 'apellido'],
        address: ['address', 'direccion', 'street'],
      };

      for (const [key, patterns] of Object.entries(commonPatterns)) {
        if (patterns.includes(a) && patterns.includes(b)) {
          return true;
        }
      }

      return false;
    },
  },
];
