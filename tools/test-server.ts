import { rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "../src/server/db.ts";
import { syncCorpus, loadCorpus } from "../src/server/corpus.ts";
const path = resolve("var/e2e/paperclub.sqlite");
mkdirSync(resolve("var/e2e"), { recursive: true });
for (const suffix of ["", "-wal", "-shm"])
  rmSync(path + suffix, { force: true });
process.env.DATABASE_PATH = path;
process.env.APP_ORIGIN = "http://127.0.0.1:4173";
process.env.PORT = "4173";
process.env.HOST = "127.0.0.1";
process.env.REGISTRATION = "invite";
process.env.LOCAL_AUTH = "true";
delete process.env.OIDC_ISSUER;
const db = new Store(path).migrate();
syncCorpus(db, loadCorpus("corpus"));
db.close();
await import("../src/server/main.ts");
