import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
    );
  }
  migrate(migrations = resolve("db/migrations")) {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)",
    );
    this.transaction(() => {
      for (const name of readdirSync(migrations)
        .filter((n) => n.endsWith(".sql"))
        .sort()) {
        const sql = readFileSync(resolve(migrations, name), "utf8");
        const checksum = createHash("sha256").update(sql).digest("hex");
        const old = this.get<{ checksum: string }>(
          "SELECT checksum FROM schema_migrations WHERE name=?",
          name,
        );
        if (old) {
          if (old.checksum !== checksum)
            throw new Error(`Applied migration changed: ${name}`);
          continue;
        }
        this.db.exec(sql);
        this.run("INSERT INTO schema_migrations VALUES (?,?)", name, checksum);
      }
    });
    return this;
  }
  get<T = Record<string, unknown>>(
    sql: string,
    ...args: SQLInputValue[]
  ): T | undefined {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }
  all<T = Record<string, unknown>>(sql: string, ...args: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...args) as T[];
  }
  run(sql: string, ...args: SQLInputValue[]) {
    return this.db.prepare(sql).run(...args);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
