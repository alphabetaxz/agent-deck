import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv (scope TEXT, key TEXT, value TEXT NOT NULL, PRIMARY KEY(scope,key));');
  }
  get(scope, key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM kv WHERE scope=? AND key=?').get(scope, key);
    return row ? JSON.parse(row.value) : fallback;
  }
  set(scope, key, value) {
    this.db.prepare('INSERT INTO kv VALUES (?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value').run(scope, key, JSON.stringify(value));
  }
  close() { this.db.close(); }
}
