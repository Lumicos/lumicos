// Service configuration.
// Defaults put everything next to the project:
//   <project>/workspace   files PersonalAI may read/write (C:\AI\PersonalAI\workspace on your PC)
//   <project>/data        memory.json, backups, attachment cache
// Override with personalai.config.json in the project root, or env vars.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  host: '127.0.0.1',
  port: 8787,
  workspaceDir: 'workspace',
  dataDir: 'data',
  /** Browser origins allowed to call the service (the Vite dev / preview servers). */
  allowedOrigins: [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:4173',
    'http://localhost:4173',
  ],
};

export function loadConfig(overrides = {}) {
  let fileCfg = {};
  const cfgPath = path.join(PROJECT_ROOT, 'personalai.config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (e) {
      console.warn(`[config] Ignoring invalid personalai.config.json: ${e.message}`);
    }
  }
  const env = {
    ...(process.env.PERSONALAI_PORT ? { port: Number(process.env.PERSONALAI_PORT) } : {}),
    ...(process.env.PERSONALAI_WORKSPACE ? { workspaceDir: process.env.PERSONALAI_WORKSPACE } : {}),
    ...(process.env.PERSONALAI_DATA ? { dataDir: process.env.PERSONALAI_DATA } : {}),
  };
  const cfg = { ...DEFAULTS, ...fileCfg, ...env, ...overrides };
  // Never listen beyond this PC.
  if (!['127.0.0.1', 'localhost', '::1'].includes(cfg.host)) {
    console.warn(`[config] host "${cfg.host}" is not local; using 127.0.0.1`);
    cfg.host = '127.0.0.1';
  }
  cfg.workspaceDir = path.resolve(PROJECT_ROOT, cfg.workspaceDir);
  cfg.dataDir = path.resolve(PROJECT_ROOT, cfg.dataDir);
  return cfg;
}

/** Folders created in a fresh workspace. */
export const DEFAULT_FOLDERS = ['documents', 'spreadsheets', 'notes', 'exports', 'skills', 'knowledge'];
