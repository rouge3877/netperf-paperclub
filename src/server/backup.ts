import { closeSync, openSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Back up the current state, including old schemas, without running migrations.
export function backupDatabase(source: string, destination: string) {
  const db = new DatabaseSync(source, { readOnly: true });
  let reserved = false;
  try {
    closeSync(openSync(destination, "wx", 0o600));
    reserved = true;
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare("VACUUM INTO ?").run(destination);
  } catch (error) {
    if (reserved) rmSync(destination, { force: true });
    throw error;
  } finally {
    db.close();
  }
}
