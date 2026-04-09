// Jest mock for bun:sqlite using better-sqlite3
const BetterSqlite3 = require('better-sqlite3');

class Database {
  constructor(path, options = {}) {
    this._db = new BetterSqlite3(path, {
      readonly: options.readonly || false,
    });
  }

  exec(sql) {
    this._db.exec(sql);
  }

  query(sql) {
    const stmt = this._db.prepare(sql);
    return {
      get: (...params) => {
        return stmt.get(...params) || null;
      },
      all: (...params) => {
        return stmt.all(...params);
      },
    };
  }

  close() {
    this._db.close();
  }
}

module.exports = { Database };
