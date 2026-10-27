import { DatabaseSync } from 'node:sqlite';
import { products } from './seed.js';

export function openDb(file = process.env.DB_FILE ?? 'data.db') {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      keywords TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      stock INTEGER NOT NULL CHECK (stock >= 0)
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      ai_enabled INTEGER NOT NULL DEFAULT 1,
      needs_human INTEGER NOT NULL DEFAULT 0,
      cart TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id),
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      author TEXT NOT NULL CHECK (author IN ('customer', 'ai', 'agent')),
      body TEXT NOT NULL,
      wa_id TEXT UNIQUE,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id),
      items TEXT NOT NULL,
      total INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      paid_at TEXT
    );
  `);
  // Bases creadas antes de guardar qué herramientas usó la IA.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'meta'").get()) {
    db.exec('ALTER TABLE messages ADD COLUMN meta TEXT');
  }
  if (!db.prepare('SELECT 1 FROM products LIMIT 1').get()) {
    const insert = db.prepare('INSERT INTO products (sku, name, keywords, price, stock) VALUES (?, ?, ?, ?, ?)');
    for (const p of products) insert.run(p.sku, p.name, p.keywords, p.price, p.stock);
  }
  return db;
}
