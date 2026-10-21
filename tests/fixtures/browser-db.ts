import { resolve } from "node:path";
import { Store } from "../../src/server/db.ts";
import { hashPassword, insertUser } from "../../src/server/auth.ts";

export const browserDatabase = resolve("var/e2e/paperclub.sqlite");
export const browserPassword = "paperclub browser test passphrase";

// Browser tests run serially against one server. Each test owns fresh mutable
// state; only the immutable corpus and schema are shared between tests.
export async function resetBrowserDatabase() {
  const password = await hashPassword(browserPassword);
  const db = new Store(browserDatabase);
  try {
    db.transaction(() => {
      for (const table of [
        "comments",
        "folders",
        "topic_proposals",
        "paper_topics",
        "topics",
        "invitations",
        "oidc_flows",
        "ratings",
        "auth_limits",
        "users",
        "metadata",
      ])
        db.run(`DELETE FROM ${table}`);
      db.run("UPDATE papers SET topic_revision=0");
      for (const name of ["alice", "bob", "carol"]) {
        const user = insertUser(
          db,
          name,
          name[0].toUpperCase() + name.slice(1),
        );
        db.run("INSERT INTO local_credentials VALUES (?,?)", user.id, password);
      }
    });
  } finally {
    db.close();
  }
}
