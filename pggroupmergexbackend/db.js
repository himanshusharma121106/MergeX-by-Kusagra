const path = require('path');
const fs = require('fs');

// Ensure .env is loaded from backend directory
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config(); // also check current working directory

const mysql = require('mysql2/promise');

let sqliteDb = null;
let activeEngine = 'mysql'; // 'mysql' | 'sqlite'
let pool = null;

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function getSqliteDb() {
  if (!sqliteDb) {
    const { DatabaseSync } = require('node:sqlite');
    const sqlitePath = path.join(dataDir, 'mergex.sqlite');
    sqliteDb = new DatabaseSync(sqlitePath);
    sqliteDb.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  }
  return sqliteDb;
}

// Translate MySQL queries to SQLite compatible queries
function adaptQueryForSqlite(sql, params) {
  let adaptedSql = sql.trim();
  let adaptedParams = params ? [...params] : [];

  // Handle identifier replacement (SHOW COLUMNS FROM ?? or SELECT * FROM ??)
  if (adaptedSql.includes('??')) {
    const parts = adaptedSql.split('??');
    let reconstructed = '';
    const newParams = [];
    let paramIndex = 0;

    for (let i = 0; i < parts.length; i++) {
      reconstructed += parts[i];
      if (i < parts.length - 1) {
        const identifier = adaptedParams[paramIndex++];
        reconstructed += `"${String(identifier).replace(/"/g, '""')}"`;
      }
    }
    while (paramIndex < adaptedParams.length) {
      newParams.push(adaptedParams[paramIndex++]);
    }
    adaptedSql = reconstructed;
    adaptedParams = newParams;
  }

  // Handle SHOW TABLES
  if (/^SHOW\s+TABLES/i.test(adaptedSql)) {
    return {
      type: 'show_tables',
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      params: []
    };
  }

  // Handle SHOW COLUMNS FROM "tableName"
  const showColsMatch = adaptedSql.match(/^SHOW\s+COLUMNS\s+FROM\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
  if (showColsMatch) {
    return {
      type: 'show_columns',
      table: showColsMatch[1],
      sql: `PRAGMA table_info("${showColsMatch[1]}")`,
      params: []
    };
  }

  // Handle TRUNCATE TABLE
  if (/^TRUNCATE\s+TABLE\s+([a-zA-Z0-9_]+)/i.test(adaptedSql)) {
    const table = adaptedSql.match(/^TRUNCATE\s+TABLE\s+([a-zA-Z0-9_]+)/i)[1];
    return {
      type: 'raw',
      sql: `DELETE FROM "${table}"`,
      params: []
    };
  }

  // Replace MySQL specific syntax
  adaptedSql = adaptedSql
    .replace(/\bCREATE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/gi, 'CREATE INDEX IF NOT EXISTS ')
    .replace(/\bENUM\s*\([^)]*\)/gi, 'TEXT')
    .replace(/CAST\((.*?)\s+AS\s+UNSIGNED\)/gi, 'CAST($1 AS INTEGER)')
    .replace(/\bINT\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/\bAUTO_INCREMENT\b/gi, '')
    .replace(/\bINSERT\s+IGNORE\s+INTO\b/gi, 'INSERT OR IGNORE INTO');

  // Handle ON DUPLICATE KEY UPDATE in common queries
  // Pattern: INSERT INTO table (cols...) VALUES (vals...) ON DUPLICATE KEY UPDATE col1=?, col2=?
  if (/ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(adaptedSql)) {
    const insertMatch = adaptedSql.match(/INSERT\s+INTO\s+([a-zA-Z0-9_`]+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*ON\s+DUPLICATE\s+KEY\s+UPDATE\s*(.*)$/is);
    if (insertMatch) {
      const table = insertMatch[1];
      const cols = insertMatch[2];
      const placeholders = insertMatch[3];
      const count = placeholders.split(',').length;
      adaptedSql = `INSERT OR REPLACE INTO ${table} (${cols}) VALUES (${placeholders})`;
      adaptedParams = adaptedParams.slice(0, count);
    }
  }

  return { type: 'standard', sql: adaptedSql, params: adaptedParams };
}

function runSqliteQuery(sql, params = []) {
  const db = getSqliteDb();
  const adapted = adaptQueryForSqlite(sql, params);

  if (adapted.type === 'show_tables') {
    const rows = db.prepare(adapted.sql).all();
    const result = rows.map(r => ({ [`Tables_in_db`]: r.name }));
    return [result, []];
  }

  if (adapted.type === 'show_columns') {
    const cols = db.prepare(adapted.sql).all();
    const result = cols.map(c => ({
      Field: c.name,
      Type: c.type,
      Null: c.notnull ? 'NO' : 'YES',
      Key: c.pk ? 'PRI' : '',
      Default: c.dflt_value,
      Extra: ''
    }));
    return [result, []];
  }

  const trimmed = adapted.sql.trim();
  const isSelect = /^SELECT\b/i.test(trimmed) || /^PRAGMA\b/i.test(trimmed);

  try {
    const stmt = db.prepare(adapted.sql);
    if (isSelect) {
      const rows = stmt.all(...adapted.params);
      return [rows, []];
    } else {
      const info = stmt.run(...adapted.params);
      const result = {
        insertId: Number(info.lastInsertRowid) || 0,
        affectedRows: info.changes || 0
      };
      return [result, []];
    }
  } catch (err) {
    // If table column already exists during migrations, ignore
    if (err.message && (err.message.includes('duplicate column name') || err.message.includes('already exists'))) {
      return [{ affectedRows: 0 }, []];
    }
    throw err;
  }
}

// Initialize MySQL pool if configured
const isSqliteForced = process.env.DB_TYPE === 'sqlite';

if (!isSqliteForced && process.env.DB_HOST) {
  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'mergex_db',
      waitForConnections: true,
      connectionLimit: process.env.DB_CONNECTION_LIMIT ? parseInt(process.env.DB_CONNECTION_LIMIT, 10) : 20,
      queueLimit: 0,
      connectTimeout: 3000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    });
  } catch (err) {
    console.warn('MySQL pool initialization error:', err.message);
    activeEngine = 'sqlite';
  }
} else {
  activeEngine = 'sqlite';
}

const dbWrapper = {
  async query(sql, params = []) {
    if (activeEngine === 'mysql' && pool) {
      try {
        return await pool.query(sql, params);
      } catch (err) {
        // If MySQL fails due to connectivity, seamlessly fallback to SQLite
        if (
          err.code === 'PROTOCOL_CONNECTION_LOST' ||
          err.code === 'ECONNREFUSED' ||
          err.code === 'ETIMEDOUT' ||
          err.code === 'ENOTFOUND' ||
          err.fatal
        ) {
          console.warn(`[DB] MySQL connection lost (${err.code || err.message}). Switching to local SQLite storage engine.`);
          activeEngine = 'sqlite';
          return runSqliteQuery(sql, params);
        }
        throw err;
      }
    }
    return runSqliteQuery(sql, params);
  },

  getActiveEngine() {
    return activeEngine;
  }
};

module.exports = dbWrapper;
