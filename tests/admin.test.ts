import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/server/db.ts";
import { createApp } from "../src/server/app.ts";
import { initializeAdmin } from "../src/server/admin.ts";
import {
  currentUser,
  insertUser,
  sessionCookie,
  verifyPassword,
} from "../src/server/auth.ts";
import { resolveIdentity } from "../src/server/oidc.ts";
import type { Config } from "../src/server/config.ts";

const config: Config = {
  origin: "http://127.0.0.1:3000",
  database: ":memory:",
  corpus: "corpus",
  web: "dist/web",
  secure: false,
  localAuth: true,
  registration: "invite",
};
const nextPassword = "a new private admin passphrase";
let db: Store, app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = new Store(":memory:").migrate();
  app = createApp(db, config);
});
afterEach(() => db.close());
async function call(path: string, cookie = "", method = "GET", body?: unknown) {
  const response = await app(
    new Request(`${config.origin}/api${path}`, {
      method,
      headers: {
        Cookie: cookie,
        ...(body === undefined
          ? {}
          : { Origin: config.origin, "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("Set-Cookie")?.split(";")[0] || "",
  };
}
async function admin() {
  const credentials = (await initializeAdmin(db))!;
  const login = await call("/auth/login", "", "POST", credentials);
  expect(login.status).toBe(200);
  const changed = await call("/auth/password", login.cookie, "POST", {
    currentPassword: credentials.password,
    password: nextPassword,
  });
  expect(changed.status).toBe(200);
  return { id: login.data.user.id as string, cookie: changed.cookie };
}
function member(name = "reader") {
  const user = insertUser(db, name, name);
  return { ...user, cookie: sessionCookie(db, config, user.id).split(";")[0] };
}
async function edit(
  cookie: string,
  id: string,
  changes: Record<string, unknown>,
) {
  const user = (await call("/admin/users", cookie)).data.users.find(
    (u: { id: string }) => u.id === id,
  );
  return call(`/admin/users/${id}`, cookie, "PATCH", { ...user, ...changes });
}

describe("user administration", () => {
  it("initializes once, preserves existing members, and stores only a salted password hash", async () => {
    const existing = member();
    const results = await Promise.all([
      initializeAdmin(db),
      initializeAdmin(db),
    ]);
    const created = results.filter(Boolean);
    expect(created).toHaveLength(1);
    const credentials = created[0]!;
    expect(credentials.password).toMatch(/^[\w-]{32}$/);
    const row = db.get<{ password_hash: string }>(
      "SELECT password_hash FROM local_credentials",
    )!;
    expect(row.password_hash).not.toContain(credentials.password);
    expect(await verifyPassword(credentials.password, row.password_hash)).toBe(
      true,
    );
    expect(await initializeAdmin(db)).toBeNull();
    expect(
      db.get("SELECT role,disabled FROM users WHERE id=?", existing.id),
    ).toEqual({ role: "member", disabled: 0 });
    expect(db.get<{ n: number }>("SELECT count(*) n FROM users")!.n).toBe(2);
  });

  it("requires changing the generated password and revokes old sessions", async () => {
    const credentials = (await initializeAdmin(db))!;
    const login = await call("/auth/login", "", "POST", credentials);
    expect(login.data.user.mustChangePassword).toBe(true);
    for (const path of ["/papers", "/admin/users", "/folders"])
      expect((await call(path, login.cookie)).status).toBe(403);
    expect(
      (
        await call("/auth/password", login.cookie, "POST", {
          currentPassword: credentials.password,
          password: credentials.password,
        })
      ).status,
    ).toBe(400);
    const changed = await call("/auth/password", login.cookie, "POST", {
      currentPassword: credentials.password,
      password: nextPassword,
    });
    expect(changed.status).toBe(200);
    expect((await call("/auth", login.cookie)).data.user).toBeNull();
    expect(
      (await call("/auth", changed.cookie)).data.user.mustChangePassword,
    ).toBe(false);
    expect((await call("/admin/users", changed.cookie)).status).toBe(200);
    expect((await call("/auth/login", "", "POST", credentials)).status).toBe(
      401,
    );
    expect(await initializeAdmin(db)).toBeNull();
  });

  it("blocks member access and registration privilege injection", async () => {
    const owner = await admin();
    const reader = member();
    expect((await call("/admin/users")).status).toBe(401);
    expect((await call("/admin/users", reader.cookie)).status).toBe(403);
    expect(
      (
        await call(`/admin/users/${owner.id}`, reader.cookie, "PATCH", {
          displayName: "hijack",
          role: "admin",
          disabled: false,
          revision: 2,
        })
      ).status,
    ).toBe(403);
    expect(
      (await call("/admin/invitations", reader.cookie, "POST", {})).status,
    ).toBe(403);
    app = createApp(db, { ...config, registration: "open" });
    const registered = await call("/auth/register", "", "POST", {
      username: "newmember",
      displayName: "New member",
      password: nextPassword,
      role: "admin",
    });
    expect(registered.status).toBe(201);
    expect(registered.data.user.role).toBe("member");
    expect(
      (
        await call("/auth/register", "", "POST", {
          username: "ADMIN",
          displayName: "Other admin",
          password: nextPassword,
        })
      ).status,
    ).toBe(400);
    const users = await call("/admin/users", owner.cookie);
    expect(JSON.stringify(users.data)).not.toMatch(/password|token|cookie/);
  });

  it("protects the last active admin and rejects stale edits", async () => {
    const owner = await admin();
    expect(
      (await edit(owner.cookie, owner.id, { role: "member" })).status,
    ).toBe(409);
    expect(
      (await edit(owner.cookie, owner.id, { disabled: true })).status,
    ).toBe(400);
    const reader = member();
    expect(
      (await edit(owner.cookie, reader.id, { displayName: "Renamed" })).status,
    ).toBe(200);
    expect(
      (
        await edit(owner.cookie, reader.id, {
          revision: 1,
          displayName: "Stale",
        })
      ).status,
    ).toBe(409);
    expect(
      db.get("SELECT display_name FROM users WHERE id=?", reader.id)
        ?.display_name,
    ).toBe("Renamed");
    expect(
      (await edit(owner.cookie, reader.id, { role: "admin" })).status,
    ).toBe(200);
    expect((await call("/auth", reader.cookie)).data.user).toBeNull();
    expect(
      (await edit(owner.cookie, owner.id, { role: "member" })).status,
    ).toBe(200);
    expect((await call("/admin/users", owner.cookie)).status).toBe(401);
  });

  it("disables local and external access immediately while preserving user content", async () => {
    const owner = await admin();
    const invite = await call("/admin/invitations", owner.cookie, "POST", {});
    const registered = await call("/auth/register", "", "POST", {
      username: "reader",
      displayName: "Reader",
      password: nextPassword,
      invitation: invite.data.token,
    });
    const reader = registered.data.user;
    const folder = await call("/folders", registered.cookie, "POST", {
      name: "Private notes",
      description: "Retain this folder",
      visibility: "private",
      ordered: true,
    });
    expect(
      (await call(`/folders/${folder.data.id}`, owner.cookie)).status,
    ).toBe(404);
    db.run(
      "INSERT INTO identities VALUES (?,?,?)",
      "https://issuer.example",
      "subject",
      reader.id,
    );
    expect(
      (await edit(owner.cookie, reader.id, { disabled: true })).status,
    ).toBe(200);
    expect((await call("/auth", registered.cookie)).data.user).toBeNull();
    expect(
      (
        await call("/auth/login", "", "POST", {
          username: "reader",
          password: nextPassword,
        })
      ).status,
    ).toBe(401);
    const external = resolveIdentity(
      db,
      config,
      { issuer: "https://issuer.example", subject: "subject" },
      null,
      null,
    );
    expect(() => sessionCookie(db, config, external.id)).toThrow("disabled");
    expect(
      currentUser(
        db,
        config,
        new Request(config.origin, { headers: { Cookie: registered.cookie } }),
      ),
    ).toBeNull();
    expect(
      db.get("SELECT name FROM folders WHERE id=?", folder.data.id)?.name,
    ).toBe("Private notes");
    expect(db.get<{ n: number }>("SELECT count(*) n FROM users")!.n).toBe(2);
    expect(
      (await edit(owner.cookie, reader.id, { disabled: false })).status,
    ).toBe(200);
    const login = await call("/auth/login", "", "POST", {
      username: "reader",
      password: nextPassword,
    });
    expect(login.status).toBe(200);
    expect(
      (await call(`/folders/${folder.data.id}`, login.cookie)).status,
    ).toBe(200);
  });

  it("issues single-use invitations with expiry and paginates member search", async () => {
    const owner = await admin();
    const invitation = await call(
      "/admin/invitations",
      owner.cookie,
      "POST",
      {},
    );
    expect(invitation.status).toBe(201);
    expect(invitation.data.expiresAt).toBeGreaterThan(Date.now());
    const input = {
      username: "invited",
      displayName: "Invited",
      password: nextPassword,
      invitation: invitation.data.token,
    };
    expect((await call("/auth/register", "", "POST", input)).status).toBe(201);
    expect(
      (
        await call("/auth/register", "", "POST", {
          ...input,
          username: "again",
        })
      ).status,
    ).toBe(403);
    for (let i = 0; i < 55; i++) insertUser(db, `reader${i}`, `Reader ${i}`);
    const first = (await call("/admin/users?q=reader", owner.cookie)).data;
    const second = (await call("/admin/users?q=reader&offset=50", owner.cookie))
      .data;
    expect(first.total).toBe(55);
    expect(first.users).toHaveLength(50);
    expect(second.users).toHaveLength(5);
    expect(
      new Set([...first.users, ...second.users].map((u) => u.id)).size,
    ).toBe(55);
  });

  it("refuses to claim an existing member named admin", async () => {
    insertUser(db, "admin", "Existing member");
    await expect(initializeAdmin(db)).rejects.toThrow("already exists");
    expect(db.get("SELECT role FROM users WHERE username='admin'")?.role).toBe(
      "member",
    );
    expect(
      db.get("SELECT 1 FROM metadata WHERE key='admin_initialized'"),
    ).toBeUndefined();
  });
});
