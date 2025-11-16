#!/usr/bin/env node

import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const baseDir = process.cwd();

const dirs = [
  'data/sessions',
  'data/form-data',
  'data/videos',
  'data/screenshots',
  'data/downloads',
  'data/traces',
  'data/agent-memory/conversations',
  'data/agent-memory/learnings',
  'data/checkpoints',
  'recordings/manual',
  'recordings/agent-generated',
  'logs',
  'backups',
];

console.log('📁 Creating necessary directories...\n');

let created = 0;
let existed = 0;

dirs.forEach(dir => {
  const fullPath = join(baseDir, dir);
  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true });
    console.log(`  ✓ Created ${dir}`);
    created++;
  } else {
    existed++;
  }
});

console.log(`\n✅ Done! Created ${created} directories (${existed} already existed)\n`);
