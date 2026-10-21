import { afterEach, beforeEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/server/db.ts";
import { insertUser } from "../src/server/auth.ts";

let directory: string, database: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "paperclub-cli-"));
  database = join(directory, "source.sqlite");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function command(args: string[], extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, [resolve("tools/admin.ts"), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_PATH: database,
      CORPUS_PATH: join(directory, "missing-corpus"),
      APP_ORIGIN: "http://127.0.0.1:3000",
      REGISTRATION: "invite",
      LOCAL_AUTH: "true",
      OIDC_ISSUER: "",
      ...extra,
    },
  });
}
function snapshot(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    return Object.fromEntries(
      tables.map(({ name }) => [
        name,
        db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
      ]),
    );
  } finally {
    db.close();
  }
}

it("backs up an old live database without migrating or importing papers", () => {
  const migrations = join(directory, "migrations");
  mkdirSync(migrations);
  for (const name of readdirSync("db/migrations").filter(
    (name) => name.endsWith(".sql") && name < "004",
  ))
    copyFileSync(join("db/migrations", name), join(migrations, name));
  const live = new Store(database).migrate(migrations);
  try {
    insertUser(live, "reader", "Reader");
    live.run(
      "INSERT INTO papers(id,title,abstract,authors,conference,year,url) VALUES (?,?,?,?,?,?,?)",
      "p-fixture",
      "Original title",
      "Original abstract",
      '["Author"]',
      "NSDI",
      2024,
      "https://example.com/paper",
    );
    const before = snapshot(database);
    const destination = join(directory, "backup.sqlite");
    const result = command(["backup", destination], { APP_ORIGIN: "invalid" });
    expect(result.status, result.stderr).toBe(0);
    expect(snapshot(database)).toEqual(before);
    expect(snapshot(destination)).toEqual(before);
    expect(live.all("PRAGMA foreign_key_check")).toEqual([]);
    if (process.platform !== "win32")
      expect(statSync(destination).mode & 0o777).toBe(0o600);
  } finally {
    live.close();
  }
});

it("never overwrites an existing backup or creates a missing source", () => {
  new Store(database).migrate().close();
  const destination = join(directory, "backup.sqlite");
  writeFileSync(destination, "keep this existing backup");
  const before = snapshot(database);
  expect(command(["backup", destination]).status).not.toBe(0);
  expect(readFileSync(destination, "utf8")).toBe("keep this existing backup");
  expect(snapshot(database)).toEqual(before);
  const missing = join(directory, "missing.sqlite");
  const unused = join(directory, "unused.sqlite");
  expect(
    command(["backup", unused], { DATABASE_PATH: missing }).status,
  ).not.toBe(0);
  expect(existsSync(missing)).toBe(false);
  expect(existsSync(unused)).toBe(false);
});

it("rejects unknown commands before opening a database", () => {
  expect(command(["typo"]).status).not.toBe(0);
  expect(existsSync(database)).toBe(false);
});

it("administers existing accounts without requiring the corpus", () => {
  const db = new Store(database).migrate();
  insertUser(db, "reader", "Reader");
  db.close();
  const before = snapshot(database);
  const result = command(["set-role", "reader", "admin"]);
  expect(result.status, result.stderr).toBe(0);
  const after = snapshot(database);
  expect(after.schema_migrations).toEqual(before.schema_migrations);
  expect(after.papers).toEqual(before.papers);
  expect(after.users).toEqual([
    expect.objectContaining({ username: "reader", role: "admin" }),
  ]);
});
