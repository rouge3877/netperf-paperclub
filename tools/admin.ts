import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { configFromEnv } from "../src/server/config.ts";
import { Store } from "../src/server/db.ts";
import { loadCorpus, syncCorpus } from "../src/server/corpus.ts";
import {
  hashPassword,
  insertUser,
  normalizeUsername,
} from "../src/server/auth.ts";
import { importTopics, evaluateProposals } from "../src/server/topics.ts";
import { initializeAdmin, createInvitation } from "../src/server/admin.ts";
import { backupDatabase } from "../src/server/backup.ts";
const [command, ...args] = process.argv.slice(2);
const usage =
  "Commands: init, create-user USERNAME [DISPLAY_NAME], reset-password USERNAME, set-role USERNAME admin|member, invite, import-topics FILE, backup FILE. Supply passwords through stdin or PAPERCLUB_PASSWORD.";
async function readPassword() {
  if (process.env.PAPERCLUB_PASSWORD) return process.env.PAPERCLUB_PASSWORD;
  if (!process.stdin.isTTY)
    return readFileSync(0, "utf8").replace(/\r?\n$/, "");
  process.stdout.write("Password (input hidden): ");
  const silent = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const prompt = createInterface({
    input: process.stdin,
    output: silent,
    terminal: true,
  });
  try {
    return await new Promise<string>((resolve, reject) => {
      prompt.question("", resolve);
      prompt.once("SIGINT", () => reject(new Error("Cancelled.")));
    });
  } finally {
    prompt.close();
    process.stdout.write("\n");
  }
}
async function main() {
  if (command === "backup") {
    if (!args[0]) throw new Error("Supply a new backup file path.");
    backupDatabase(
      resolve(process.env.DATABASE_PATH || "var/paperclub.sqlite"),
      resolve(args[0]),
    );
    console.log("Consistent SQLite backup saved.");
    return;
  }
  if (
    ![
      "init",
      "import-topics",
      "create-user",
      "reset-password",
      "set-role",
      "invite",
    ].includes(command)
  )
    throw new Error(usage);
  const config = configFromEnv();
  if (command === "init" && !config.localAuth)
    throw new Error(
      "Enable LOCAL_AUTH for initial setup, then link an external identity before disabling it.",
    );
  if (command !== "init" && !existsSync(config.database))
    throw new Error("Run npm run init before administering this database.");
  const db = new Store(config.database);
  try {
    if (command === "init") {
      const papers = loadCorpus(config.corpus);
      db.migrate();
      syncCorpus(db, papers);
      const credentials = await initializeAdmin(db);
      if (credentials) {
        console.log(
          `Admin initialized. Save this password; it is shown only once.\nUsername: ${credentials.username}\nPassword: ${credentials.password}\nSign in and change this initial password before using Paperclub.`,
        );
      } else
        console.log(
          "Already initialized. Existing accounts and passwords are unchanged.",
        );
    } else if (command === "import-topics") {
      if (!args[0])
        throw new Error(
          "Usage: npm run topics:import -- /path/to/topics-seed.json",
        );
      importTopics(db, JSON.parse(readFileSync(args[0], "utf8")));
      console.log(
        "Initial topics imported. Later classifications will not be overwritten.",
      );
    } else if (command === "create-user") {
      const username = normalizeUsername(args[0]);
      if (username === "admin")
        throw new Error(
          "Use npm run init to create the default administrator.",
        );
      const name = args[1] || username;
      const password = await readPassword();
      const passwordHash = await hashPassword(password);
      db.transaction(() => {
        const user = insertUser(db, username, name.slice(0, 80));
        db.run(
          "INSERT INTO local_credentials VALUES (?,?)",
          user.id,
          passwordHash,
        );
        evaluateProposals(db);
      });
      console.log(`Created user ${username}.`);
    } else if (command === "reset-password") {
      const user = db.get<{ id: string }>(
        "SELECT id FROM users WHERE username=?",
        normalizeUsername(args[0]),
      );
      if (!user) throw new Error("Unknown user.");
      const password = await readPassword();
      const passwordHash = await hashPassword(password);
      db.transaction(() => {
        db.run(
          "INSERT INTO local_credentials VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash",
          user.id,
          passwordHash,
        );
        db.run("DELETE FROM sessions WHERE user_id=?", user.id);
        db.run(
          "UPDATE users SET require_password_change=1,revision=revision+1 WHERE id=?",
          user.id,
        );
      });
      console.log(
        "Password reset; existing sessions revoked. The user must change it after signing in.",
      );
    } else if (command === "set-role") {
      const username = normalizeUsername(args[0]);
      const role = args[1];
      if (role !== "admin" && role !== "member")
        throw new Error("Choose admin or member.");
      db.transaction(() => {
        const user = db.get<{ id: string; role: string; disabled: number }>(
          "SELECT id,role,disabled FROM users WHERE username=?",
          username,
        );
        if (!user) throw new Error("Unknown user.");
        if (
          role === "member" &&
          user.role === "admin" &&
          !user.disabled &&
          !db.get(
            "SELECT 1 FROM users WHERE role='admin' AND disabled=0 AND id<>?",
            user.id,
          )
        )
          throw new Error("Keep at least one active administrator.");
        db.run(
          "UPDATE users SET role=?,revision=revision+1 WHERE id=?",
          role,
          user.id,
        );
        db.run("DELETE FROM sessions WHERE user_id=?", user.id);
      });
      console.log(`Updated ${username} to ${role}; existing sessions revoked.`);
    } else if (command === "invite") {
      const { token } = createInvitation(db);
      console.log(`Single-use invitation (expires in 7 days): ${token}`);
    }
  } finally {
    db.close();
  }
}
try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Administration failed.",
  );
  process.exitCode = 1;
}
