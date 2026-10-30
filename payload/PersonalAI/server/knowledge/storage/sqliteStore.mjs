import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { KnowledgeStore } from './store.mjs';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION_NAME = /^(\d+)_([a-z0-9_]+)\.sql$/i;

export class SqliteKnowledgeStore extends KnowledgeStore {
  constructor(filename, { migrationsDir = MIGRATIONS_DIR } = {}) {
    super();
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.migrationsDir = migrationsDir;
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (filename !== ':memory:') this.database.exec('PRAGMA journal_mode = WAL;');
  }

  migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const applied = new Set(
      this.database.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version),
    );
    const files = fs.readdirSync(this.migrationsDir)
      .map((name) => ({ name, match: MIGRATION_NAME.exec(name) }))
      .filter((entry) => entry.match)
      .map((entry) => ({ name: entry.name, version: Number(entry.match[1]), label: entry.match[2] }))
      .sort((a, b) => a.version - b.version);
    const seen = new Set();
    for (const migration of files) {
      if (seen.has(migration.version)) throw new Error(`Duplicate knowledge migration version ${migration.version}.`);
      seen.add(migration.version);
      if (applied.has(migration.version)) continue;
      const sql = fs.readFileSync(path.join(this.migrationsDir, migration.name), 'utf8');
      this.transaction(() => {
        this.database.exec(sql);
        this.database.prepare(
          'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
        ).run(migration.version, migration.label, new Date().toISOString());
      });
    }
    return this.schemaVersion();
  }

  schemaVersion() {
    const exists = this.database.prepare(
      "SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    ).get();
    if (!exists) return 0;
    return this.database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version;
  }

  transaction(work) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work(this.database);
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}

