import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { Store } from "./db.ts";
import type { Config } from "./config.ts";
import type { User, SessionUser } from "../shared/types.ts";
import { check, text } from "./errors.ts";
import { evaluateProposals } from "./topics.ts";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const ttl = 7 * 86400_000;
const pattern = /^scrypt\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;
let kdfs = 0;
export function validPassword(p: unknown): p is string {
  return (
    typeof p === "string" &&
    [...p].length >= 15 &&
    [...p].length <= 128 &&
    Buffer.byteLength(p) <= 512
  );
}
async function derive(password: string, salt: Buffer) {
  check(kdfs < 4, 429, "Sign-in is busy. Please try again.");
  kdfs++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        password,
        salt,
        32,
        { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 },
        (e, key) => (e ? reject(e) : resolve(key)),
      ),
    );
  } finally {
    kdfs--;
  }
}
export async function hashPassword(password: string) {
  check(validPassword(password), 400, "Use a password of 15–128 characters.");
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await derive(password, salt)).toString("base64url")}`;
}
export async function verifyPassword(
  password: string,
  stored: string | undefined,
) {
  const match = pattern.exec(stored || "");
  const salt = match ? Buffer.from(match[1], "base64url") : Buffer.alloc(16, 7);
  const actual = await derive(password, salt);
  return !!match && timingSafeEqual(actual, Buffer.from(match[2], "base64url"));
}
export const cookieName = (config: Config) =>
  config.secure ? "__Host-paperclub_session" : "paperclub_session";
export function cookieValue(request: Request, name: string) {
  const values = (request.headers.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.startsWith(`${name}=`))
    .map((x) => x.slice(name.length + 1));
  return values.length === 1 ? values[0] : null;
}
export function currentUser(
  db: Store,
  config: Config,
  request: Request,
): SessionUser | null {
  const token = cookieValue(request, cookieName(config));
  if (!token || !/^[\w-]{43}$/.test(token)) return null;
  const row = db.get<SessionUser>(
    "SELECT u.id,u.username,u.display_name AS displayName,u.role,u.require_password_change AS mustChangePassword FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0",
    hash(token),
    Date.now(),
  );
  return row ? { ...row, mustChangePassword: !!row.mustChangePassword } : null;
}
export function sessionCookie(db: Store, config: Config, userId: string) {
  check(
    db.get("SELECT 1 FROM users WHERE id=? AND disabled=0", userId),
    403,
    "This account is disabled.",
  );
  const token = randomBytes(32).toString("base64url");
  db.run("DELETE FROM sessions WHERE expires_at<=?", Date.now());
  db.run(
    "INSERT INTO sessions VALUES (?,?,?)",
    hash(token),
    userId,
    Date.now() + ttl,
  );
  db.run(
    "DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires_at DESC LIMIT 5)",
    userId,
    userId,
  );
  return `${cookieName(config)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl / 1000}${config.secure ? "; Secure" : ""}`;
}
export function logout(db: Store, config: Config, request: Request) {
  const token = cookieValue(request, cookieName(config));
  if (token) db.run("DELETE FROM sessions WHERE token_hash=?", hash(token));
  return `${cookieName(config)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.secure ? "; Secure" : ""}`;
}
export function authLimit(db: Store, ip: string, username: string) {
  db.transaction(() => {
    const now = Date.now();
    db.run("DELETE FROM auth_limits WHERE expires_at<=?", now);
    check(
      db.get<{ n: number }>("SELECT count(*) n FROM auth_limits")!.n < 10000,
      429,
      "Sign-in is busy.",
    );
    for (const [key, max, span] of [
      [`ip:${hash(ip)}`, 30, 60000],
      [`name:${hash(username)}`, 12, 600000],
      ["global", 120, 60000],
    ] as const) {
      const bucket = `${key}:${Math.floor(now / span)}`;
      const count =
        db.get<{ count: number }>(
          "SELECT count FROM auth_limits WHERE key=?",
          bucket,
        )?.count || 0;
      check(count < max, 429, "Too many sign-in attempts. Please wait.");
      db.run(
        "INSERT INTO auth_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
        bucket,
        now + span,
      );
    }
  });
}
export function normalizeUsername(input: unknown) {
  const name = text(input, "Username", 32, 3).toLowerCase();
  check(
    /^[a-z0-9][a-z0-9_-]*$/.test(name),
    400,
    "Use letters, numbers, underscores or hyphens for the username.",
  );
  return name;
}
export function consumeInvitation(
  db: Store,
  config: Config,
  invitation: string | undefined,
  userId: string,
) {
  check(config.registration !== "closed", 403, "Registration is closed.");
  if (config.registration === "open") return;
  check(typeof invitation === "string", 403, "A valid invitation is required.");
  const result = db.run(
    "UPDATE invitations SET used_by=? WHERE token_hash=? AND used_by IS NULL AND expires_at>?",
    userId,
    hash(invitation),
    Date.now(),
  );
  check(
    result.changes === 1,
    403,
    "This invitation is invalid, used, or expired.",
  );
}
export function insertUser(
  db: Store,
  username: string,
  displayName: string,
): User {
  check(
    !db.get("SELECT 1 FROM users WHERE username=?", username),
    409,
    "That username is already in use.",
  );
  const user = { id: randomUUID(), username, displayName };
  db.run(
    "INSERT INTO users(id,username,display_name,created_at) VALUES (?,?,?,?)",
    user.id,
    username,
    displayName,
    Date.now(),
  );
  return user;
}
export async function register(
  db: Store,
  config: Config,
  input: Record<string, unknown>,
) {
  check(config.localAuth, 403, "Local sign-in is disabled.");
  check(config.registration !== "closed", 403, "Registration is closed.");
  const username = normalizeUsername(input.username),
    name = text(input.displayName, "Display name", 80);
  check(
    username !== "admin",
    400,
    "This username is reserved for initialization.",
  );
  check(
    validPassword(input.password),
    400,
    "Use a password of 15–128 characters.",
  );
  if (config.registration === "invite")
    check(
      typeof input.invitation === "string" &&
        db.get(
          "SELECT 1 FROM invitations WHERE token_hash=? AND used_by IS NULL AND expires_at>?",
          hash(input.invitation),
          Date.now(),
        ),
      403,
      "A valid invitation is required.",
    );
  const passwordHash = await hashPassword(input.password);
  return db.transaction(() => {
    const user = insertUser(db, username, name);
    consumeInvitation(
      db,
      config,
      input.invitation as string | undefined,
      user.id,
    );
    db.run("INSERT INTO local_credentials VALUES (?,?)", user.id, passwordHash);
    evaluateProposals(db);
    return {
      user: { ...user, role: "member" as const, mustChangePassword: false },
      cookie: sessionCookie(db, config, user.id),
    };
  });
}
export async function login(
  db: Store,
  config: Config,
  input: Record<string, unknown>,
) {
  check(config.localAuth, 403, "Local sign-in is disabled.");
  const username = normalizeUsername(input.username);
  check(
    typeof input.password === "string" && input.password.length <= 512,
    400,
    "Enter a valid password.",
  );
  const row = db.get<SessionUser & { password_hash: string }>(
    "SELECT u.id,u.username,u.display_name AS displayName,u.role,u.require_password_change AS mustChangePassword,c.password_hash FROM users u JOIN local_credentials c ON c.user_id=u.id WHERE u.username=? AND u.disabled=0",
    username,
  );
  check(
    await verifyPassword(input.password, row?.password_hash),
    401,
    "Invalid username or password.",
  );
  return db.transaction(() => {
    check(
      row &&
        db.get(
          "SELECT 1 FROM local_credentials WHERE user_id=? AND password_hash=?",
          row.id,
          row.password_hash,
        ),
      401,
      "Credentials changed. Sign in again.",
    );
    return {
      user: {
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        role: row.role,
        mustChangePassword: !!row.mustChangePassword,
      },
      cookie: sessionCookie(db, config, row.id),
    };
  });
}
export async function changePassword(
  db: Store,
  config: Config,
  request: Request,
  input: Record<string, unknown>,
) {
  const user = currentUser(db, config, request);
  check(user, 401, "Sign in to continue.");
  const old = db.get<{ password_hash: string }>(
    "SELECT password_hash FROM local_credentials WHERE user_id=?",
    user.id,
  );
  check(old, 400, "This account uses external sign-in.");
  check(
    typeof input.currentPassword === "string" &&
      input.currentPassword.length <= 512,
    400,
    "Enter your current password.",
  );
  check(
    await verifyPassword(input.currentPassword, old.password_hash),
    403,
    "Current password is incorrect.",
  );
  check(
    validPassword(input.password),
    400,
    "Use a password of 15–128 characters.",
  );
  check(
    input.password !== input.currentPassword,
    400,
    "Choose a different password.",
  );
  const next = await hashPassword(input.password);
  return db.transaction(() => {
    check(
      currentUser(db, config, request)?.id === user.id,
      401,
      "Sign in again.",
    );
    const result = db.run(
      "UPDATE local_credentials SET password_hash=? WHERE user_id=? AND password_hash=?",
      next,
      user.id,
      old.password_hash,
    );
    check(result.changes === 1, 409, "Credentials changed. Sign in again.");
    db.run(
      "UPDATE users SET require_password_change=0,revision=revision+1 WHERE id=?",
      user.id,
    );
    db.run("DELETE FROM sessions WHERE user_id=?", user.id);
    return sessionCookie(db, config, user.id);
  });
}
