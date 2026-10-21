import { randomBytes } from "node:crypto";
import type { Store } from "./db.ts";
import type { AdminUser, SessionUser } from "../shared/types.ts";
import { hash, hashPassword, insertUser } from "./auth.ts";
import { check, flag, text } from "./errors.ts";
import { evaluateProposals } from "./topics.ts";

export async function initializeAdmin(db: Store) {
  if (db.get("SELECT 1 FROM metadata WHERE key='admin_initialized'"))
    return null;
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await hashPassword(password);
  return db.transaction(() => {
    if (db.get("SELECT 1 FROM metadata WHERE key='admin_initialized'"))
      return null;
    const existing = db.get<{ role: string }>(
      "SELECT role FROM users WHERE username='admin'",
    );
    check(
      !existing || existing.role === "admin",
      409,
      "The username admin already exists. Use the administration CLI to promote the intended account before initializing.",
    );
    if (existing) {
      db.run(
        "INSERT INTO metadata VALUES ('admin_initialized',?)",
        String(Date.now()),
      );
      return null;
    }
    const user = insertUser(db, "admin", "Administrator");
    db.run(
      "UPDATE users SET role='admin',require_password_change=1 WHERE id=?",
      user.id,
    );
    db.run("INSERT INTO local_credentials VALUES (?,?)", user.id, passwordHash);
    db.run(
      "INSERT INTO metadata VALUES ('admin_initialized',?)",
      String(Date.now()),
    );
    evaluateProposals(db);
    return { username: user.username, password };
  });
}

export function requireAdmin(db: Store, user: SessionUser) {
  check(
    db.get(
      "SELECT 1 FROM users WHERE id=? AND role='admin' AND disabled=0 AND require_password_change=0",
      user.id,
    ),
    403,
    "Administrator access is required.",
  );
}

export function listUsers(
  db: Store,
  user: SessionUser,
  params: URLSearchParams,
) {
  requireAdmin(db, user);
  const query = `%${(params.get("q") || "").slice(0, 80)}%`;
  const rawOffset = Number(params.get("offset"));
  const offset = Number.isSafeInteger(rawOffset) ? Math.max(0, rawOffset) : 0;
  const where = "WHERE username LIKE ? OR display_name LIKE ?";
  const users = db
    .all<AdminUser>(
      `SELECT id,username,display_name AS displayName,role,disabled,revision,created_at AS createdAt FROM users ${where} ORDER BY created_at,id LIMIT 50 OFFSET ?`,
      query,
      query,
      offset,
    )
    .map((row) => ({ ...row, disabled: !!row.disabled }));
  return {
    users,
    total: db.get<{ n: number }>(
      `SELECT count(*) n FROM users ${where}`,
      query,
      query,
    )!.n,
  };
}

export function updateUser(
  db: Store,
  actor: SessionUser,
  id: string,
  input: Record<string, unknown>,
) {
  const displayName = text(input.displayName, "Display name", 80);
  check(
    input.role === "admin" || input.role === "member",
    400,
    "Choose a valid role.",
  );
  const disabled = flag(input.disabled, "Disabled");
  const role = input.role;
  return db.transaction(() => {
    requireAdmin(db, actor);
    const old = db.get<AdminUser>(
      "SELECT id,role,disabled,revision FROM users WHERE id=?",
      id,
    );
    check(old, 404, "User not found.");
    check(
      input.revision === old.revision,
      409,
      "This account changed. Reopen the editor and try again.",
    );
    check(
      !(id === actor.id && disabled),
      400,
      "You cannot disable your own account.",
    );
    if (
      old.role === "admin" &&
      !old.disabled &&
      (role !== "admin" || disabled)
    ) {
      check(
        db.get<{ n: number }>(
          "SELECT count(*) n FROM users WHERE role='admin' AND disabled=0 AND id<>?",
          id,
        )!.n > 0,
        409,
        "Keep at least one active administrator.",
      );
    }
    db.run(
      "UPDATE users SET display_name=?,role=?,disabled=?,revision=revision+1 WHERE id=?",
      displayName,
      role,
      Number(disabled),
      id,
    );
    if (disabled || old.role !== role) {
      db.run("DELETE FROM sessions WHERE user_id=?", id);
      db.run("DELETE FROM oidc_flows WHERE link_user=?", id);
    }
    return { ok: true };
  });
}

export function createInvitation(db: Store) {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + 7 * 86400000;
  db.run(
    "INSERT INTO invitations(token_hash,created_at,expires_at) VALUES (?,?,?)",
    hash(token),
    Date.now(),
    expiresAt,
  );
  return { token, expiresAt };
}
