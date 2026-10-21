import { afterEach, beforeEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/db.ts";
import { loadCorpus, syncCorpus } from "../src/server/corpus.ts";
import { createApp } from "../src/server/app.ts";
import {
  hashPassword,
  insertUser,
  sessionCookie,
  hash,
} from "../src/server/auth.ts";
import { evaluateProposals, importTopics } from "../src/server/topics.ts";
import { resolveIdentity } from "../src/server/oidc.ts";
import { sortPapers } from "../src/shared/types.ts";
import type { Config } from "../src/server/config.ts";
import type { User } from "../src/shared/types.ts";
const papers = loadCorpus("corpus").slice(0, 8),
  pass = "a long test passphrase 2026";
const config: Config = {
  origin: "http://127.0.0.1:3000",
  database: ":memory:",
  corpus: "corpus",
  web: "dist/web",
  secure: false,
  registration: "open",
  localAuth: true,
};
let db: Store,
  app: ReturnType<typeof createApp>,
  owner: User,
  editor: User,
  reader: User,
  outsider: User,
  passwordHash: string;
const cookies = new Map<string, string>();
beforeAll(async () => {
  passwordHash = await hashPassword(pass);
});
beforeEach(() => {
  db = new Store(":memory:").migrate();
  syncCorpus(db, papers);
  app = createApp(db, config);
  cookies.clear();
  [owner, editor, reader, outsider] = [
    "owner",
    "editor",
    "reader",
    "outsider",
  ].map((name) => {
    const user = insertUser(db, name, name.toUpperCase());
    db.run("INSERT INTO local_credentials VALUES (?,?)", user.id, passwordHash);
    cookies.set(user.id, sessionCookie(db, config, user.id).split(";")[0]);
    return user;
  });
});
afterEach(() => db.close());
async function call(
  path: string,
  user: User | null = owner,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await app(
    new Request(config.origin + "/api" + path, {
      method,
      headers: {
        ...(user ? { Cookie: cookies.get(user.id)! } : {}),
        ...(body === undefined
          ? {}
          : { Origin: config.origin, "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    "127.0.0.1",
  );
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie"),
  };
}
async function folder(visibility = "private", ordered = true) {
  const f = await call("/folders", owner, "POST", {
    name: "Research folder",
    description: "A curated reading sequence.",
    ordered,
    visibility,
  });
  expect(f.status).toBe(201);
  return f.data.id as string;
}
async function add(
  id: string,
  paperIds = papers.slice(0, 3).map((p) => p.id),
  user = owner,
) {
  const f = await call(`/folders/${id}`, user);
  return call(`/folders/${id}/papers`, user, "POST", {
    revision: f.data.revision,
    paperIds,
  });
}
async function proposal(topics = ["Congestion Control"]) {
  const r = await call(`/papers/${papers[0].id}/proposals`, owner, "POST", {
    revision: 0,
    topics,
    reason: "The abstract explicitly studies this research problem.",
  });
  expect(r.status).toBe(201);
  return r.data.id;
}
describe("authenticated service", () => {
  it("migrates existing folder items without losing content", () => {
    const dir = mkdtempSync(join(tmpdir(), "paperclub-note-migration-"));
    const initialMigrations = join(dir, "migrations");
    mkdirSync(initialMigrations);
    copyFileSync(
      "db/migrations/001_initial.sql",
      join(initialMigrations, "001_initial.sql"),
    );
    const file = join(dir, "old.sqlite");
    const old = new Store(file).migrate(initialMigrations);
    syncCorpus(old, papers);
    const user = insertUser(old, "original", "Original");
    old.run(
      "INSERT INTO folders(id,owner_id,name,description,ordered,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      "original-folder",
      user.id,
      "Original folder",
      "",
      1,
      "private",
      1,
      1,
    );
    old.run(
      "INSERT INTO folder_items VALUES (?,?,?)",
      "original-folder",
      papers[0].id,
      0,
    );
    old.close();
    const migrated = new Store(file).migrate();
    try {
      expect(migrated.get("SELECT * FROM folder_items")).toEqual({
        folder_id: "original-folder",
        paper_id: papers[0].id,
        position: 0,
        note: "",
      });
      expect(migrated.all("PRAGMA foreign_key_check")).toEqual([]);
      expect(migrated.get("SELECT name FROM folders")?.name).toBe(
        "Original folder",
      );
    } finally {
      migrated.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("enforces folder-note permissions, revisions and size limits", async () => {
    const id = await folder(),
      added = await add(id);
    const endpoint = `/folders/${id}/papers/${papers[0].id}/note`;
    const note = {
      revision: added.data.revision,
      note: "Read after the measurement paper.",
    };
    expect((await call(endpoint, null, "PUT", note)).status).toBe(401);
    expect((await call(endpoint, reader, "PUT", note)).status).toBe(404);
    let f = await call(endpoint, owner, "PUT", note);
    expect(f.status).toBe(200);
    expect(f.data.papers[0].note).toBe(note.note);
    expect((await call(endpoint, owner, "PUT", note)).status).toBe(409);
    f = await call(`/folders/${id}/collaborators`, owner, "PUT", {
      revision: f.data.revision,
      userId: editor.id,
      add: true,
    });
    f = await call(endpoint, editor, "PUT", {
      revision: f.data.revision,
      note: "Shared collaborator note.",
    });
    expect(f.status).toBe(200);
    expect(f.data.papers[0].note).toBe("Shared collaborator note.");
    expect(
      (
        await call(endpoint, editor, "PUT", {
          revision: f.data.revision,
          note: "x".repeat(5001),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(`/folders/${id}/papers/${papers[7].id}/note`, owner, "PUT", {
          revision: f.data.revision,
          note: "Absent",
        })
      ).status,
    ).toBe(404);
    f = await call(`/folders/${id}`, owner, "PATCH", {
      revision: f.data.revision,
      visibility: "public",
    });
    expect((await call(`/folders/${id}`, reader)).data.papers[0].note).toBe(
      "Shared collaborator note.",
    );
    expect(
      (
        await call(endpoint, reader, "PUT", {
          revision: f.data.revision,
          note: "Unauthorized",
        })
      ).status,
    ).toBe(403);
    f = await call(endpoint, editor, "PUT", {
      revision: f.data.revision,
      note: "",
    });
    expect(f.data.papers[0].note).toBe("");
  });
  it("preserves notes during reordering/additions and copies independent notes on fork", async () => {
    const id = await folder("public"),
      added = await add(id);
    let f = await call(
      `/folders/${id}/papers/${papers[0].id}/note`,
      owner,
      "PUT",
      {
        revision: added.data.revision,
        note: "Start with the experiment setup.",
      },
    );
    f = await call(`/folders/${id}/order`, owner, "PUT", {
      revision: f.data.revision,
      paperIds: f.data.papers.map((p: any) => p.id).reverse(),
    });
    f = await add(id, [papers[3].id]);
    expect(f.data.papers.find((p: any) => p.id === papers[0].id).note).toBe(
      "Start with the experiment setup.",
    );
    const copy = await call(`/folders/${id}/fork`, reader, "POST", {});
    const fork = await call(`/folders/${copy.data.id}`, reader);
    expect(fork.data.papers.map((p: any) => p.note)).toEqual(
      f.data.papers.map((p: any) => p.note),
    );
    f = await call(`/folders/${id}/papers/${papers[0].id}/note`, owner, "PUT", {
      revision: f.data.revision,
      note: "Changed source note.",
    });
    expect(
      (await call(`/folders/${copy.data.id}`, reader)).data.papers.find(
        (p: any) => p.id === papers[0].id,
      ).note,
    ).toBe("Start with the experiment setup.");
    await call(`/folders/${id}/papers`, owner, "DELETE", {
      revision: f.data.revision,
      paperIds: [papers[0].id],
    });
    f = await add(id, [papers[0].id]);
    expect(f.data.papers.find((p: any) => p.id === papers[0].id).note).toBe("");
  });
  it("requires authentication and exact-origin JSON on writes", async () => {
    for (const path of [
      "/papers",
      "/folders",
      "/proposals",
      "/users",
      "/community",
      "/community/comments",
      "/community/proposals",
    ])
      expect((await call(path, null)).status).toBe(401);
    expect(
      (
        await call(
          "/folders",
          owner,
          "POST",
          { name: "bad", ordered: true },
          { Origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "/folders",
          owner,
          "POST",
          { name: "bad", ordered: true },
          { "Content-Type": "text/plain" },
        )
      ).status,
    ).toBe(415);
    const own = await call("/auth", owner);
    expect(own.data.user.id).toBe(owner.id);
    expect(JSON.stringify(own.data)).not.toContain(passwordHash);
  });
  it("logs in, rotates passwords and revokes other sessions", async () => {
    expect(
      (
        await call("/auth/login", null, "POST", {
          username: "owner",
          password: "wrong",
        })
      ).status,
    ).toBe(401);
    const logged = await call("/auth/login", null, "POST", {
      username: "owner",
      password: pass,
    });
    expect(logged.status).toBe(200);
    expect(logged.cookie).toContain("HttpOnly");
    const oldCookie = cookies.get(owner.id)!;
    const changed = await call("/auth/password", owner, "POST", {
      currentPassword: pass,
      password: "another long test passphrase",
    });
    expect(changed.status).toBe(200);
    expect(
      (await call("/papers", null, "GET", undefined, { Cookie: oldCookie }))
        .status,
    ).toBe(401);
    expect(
      (
        await call("/auth/login", null, "POST", {
          username: "owner",
          password: pass,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call("/auth/login", null, "POST", {
          username: "owner",
          password: "another long test passphrase",
        })
      ).status,
    ).toBe(200);
  });
  it("uses invitations only once and does not partially create rejected accounts", async () => {
    app = createApp(db, { ...config, registration: "invite" });
    const payload = {
      username: "newmember",
      displayName: "New Member",
      password: pass,
      invitation: "wrong",
    };
    expect((await call("/auth/register", null, "POST", payload)).status).toBe(
      403,
    );
    expect(
      db.get("SELECT 1 FROM users WHERE username='newmember'"),
    ).toBeUndefined();
    db.run(
      "INSERT INTO invitations(token_hash,created_at,expires_at) VALUES (?,?,?)",
      hash("valid-invite"),
      Date.now(),
      Date.now() + 60000,
    );
    const accepted = await call("/auth/register", null, "POST", {
      ...payload,
      invitation: "valid-invite",
    });
    expect(accepted.status).toBe(201);
    expect(
      (
        await call("/auth/register", null, "POST", {
          ...payload,
          username: "another",
          invitation: "valid-invite",
        })
      ).status,
    ).toBe(403);
  });
  it("limits password attempts", async () => {
    for (let i = 0; i < 12; i++)
      await call("/auth/login", null, "POST", {
        username: "ghost",
        password: "wrong",
      });
    expect(
      (
        await call("/auth/login", null, "POST", {
          username: "ghost",
          password: "wrong",
        })
      ).status,
    ).toBe(429);
  });
});
describe("folders and access", () => {
  it("enforces private access, collaborator capabilities and revocation", async () => {
    const id = await folder();
    expect((await call(`/folders/${id}`, reader)).status).toBe(404);
    let f = await call(`/folders/${id}/collaborators`, owner, "PUT", {
      revision: 1,
      userId: editor.id,
      add: true,
    });
    expect(f.status).toBe(200);
    expect((await call(`/folders/${id}`, editor)).status).toBe(200);
    f = await call(`/folders/${id}`, editor, "PATCH", {
      revision: f.data.revision,
      name: "Edited together",
    });
    expect(f.status).toBe(200);
    expect(
      (
        await call(`/folders/${id}`, editor, "PATCH", {
          revision: f.data.revision,
          visibility: "public",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(`/folders/${id}`, editor, "DELETE", {
          revision: f.data.revision,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(`/folders/${id}/collaborators`, editor, "PUT", {
          revision: f.data.revision,
          userId: reader.id,
          add: true,
        })
      ).status,
    ).toBe(403);
    await call(`/folders/${id}/collaborators`, owner, "PUT", {
      revision: f.data.revision,
      userId: editor.id,
      add: false,
    });
    expect((await call(`/folders/${id}`, editor)).status).toBe(404);
    expect(
      (await call("/folders?scope=mine", editor)).data.folders,
    ).toHaveLength(0);
  });
  it("deduplicates additions and rejects stale or invalid edits atomically", async () => {
    const id = await folder();
    const added = await add(id);
    expect(added.data.paperCount).toBe(3);
    const again = await add(id, [papers[0].id, papers[0].id]);
    expect(again.data.paperCount).toBe(3);
    expect(
      (
        await call(`/folders/${id}/papers`, owner, "POST", {
          revision: 1,
          paperIds: [papers[3].id],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(`/folders/${id}/papers`, owner, "POST", {
          revision: again.data.revision,
          paperIds: [papers[3].id, "unknown"],
        })
      ).status,
    ).toBe(400);
    expect((await call(`/folders/${id}`)).data.paperCount).toBe(3);
    const inserted = await call(`/folders/${id}/papers`, owner, "POST", {
      revision: again.data.revision,
      paperIds: [papers[3].id],
      afterId: papers[0].id,
    });
    expect(inserted.data.papers.map((p: any) => p.id)).toEqual([
      papers[0].id,
      papers[3].id,
      papers[1].id,
      papers[2].id,
    ]);
  });
  it("keeps reader progress independent across reorder, removal, re-add and privacy changes", async () => {
    const id = await folder("public");
    let f = await add(id);
    await call(`/folders/${id}/progress`, reader, "PUT", {
      paperId: papers[0].id,
      completed: true,
      current: true,
    });
    expect(
      (await call(`/folders/${id}`, editor)).data.progress.completed,
    ).toEqual([]);
    f = await call(`/folders/${id}/order`, owner, "PUT", {
      revision: f.data.revision,
      paperIds: [papers[2].id, papers[1].id, papers[0].id],
    });
    expect(f.status).toBe(200);
    let r = await call(`/folders/${id}`, reader);
    expect(r.data.progress.completed).toEqual([papers[0].id]);
    expect(r.data.progress.currentPaperId).toBe(papers[0].id);
    f = await call(`/folders/${id}/papers`, owner, "DELETE", {
      revision: f.data.revision,
      paperIds: [papers[0].id],
    });
    r = await call(`/folders/${id}`, reader);
    expect(r.data.progress.completed).toEqual([]);
    expect(r.data.progress.currentPaperId).toBe(papers[2].id);
    f = await add(id, [papers[0].id]);
    expect(
      (await call(`/folders/${id}`, reader)).data.progress.completed,
    ).toEqual([papers[0].id]);
    await call(`/folders/${id}`, owner, "PATCH", {
      revision: f.data.revision,
      visibility: "private",
    });
    expect(
      (
        await call(`/folders/${id}/progress`, reader, "PUT", {
          paperId: papers[0].id,
          current: true,
        })
      ).status,
    ).toBe(404);
  });
  it("requires a complete permutation and leaves unordered folders as sets", async () => {
    const id = await folder();
    const f = await add(id);
    expect(
      (
        await call(`/folders/${id}/order`, owner, "PUT", {
          revision: f.data.revision,
          paperIds: [papers[0].id],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(`/folders/${id}/order`, owner, "PUT", {
          revision: f.data.revision,
          paperIds: [papers[0].id, papers[0].id, papers[1].id],
        })
      ).status,
    ).toBe(400);
    const unordered = await folder("public", false),
      u = await add(unordered);
    expect(
      (
        await call(`/folders/${unordered}/order`, owner, "PUT", {
          revision: u.data.revision,
          paperIds: u.data.papers.map((p: any) => p.id),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(`/folders/${unordered}/progress`, reader, "PUT", {
          paperId: papers[0].id,
          current: true,
        })
      ).status,
    ).toBe(400);
    expect(u.data.progress).toBeNull();
  });
  it("forks privately without copying collaborators, comments, stars or progress", async () => {
    const id = await folder("public");
    let f = await add(id);
    f = await call(`/folders/${id}/collaborators`, owner, "PUT", {
      revision: f.data.revision,
      userId: editor.id,
      add: true,
    });
    await call("/comments", reader, "POST", {
      folderId: id,
      body: "Useful folder.",
    });
    await call(`/folders/${id}/star`, reader, "PUT", { starred: true });
    await call(`/folders/${id}/star`, reader, "PUT", { starred: true });
    expect((await call(`/folders/${id}`, owner)).data.stars).toBe(1);
    await call(`/folders/${id}/progress`, reader, "PUT", {
      paperId: papers[0].id,
      completed: true,
    });
    const fork = await call(`/folders/${id}/fork`, reader, "POST", {
      name: "My independent copy",
      ordered: true,
    });
    expect(fork.status).toBe(201);
    const copy = await call(`/folders/${fork.data.id}`, reader);
    expect(copy.data.visibility).toBe("private");
    expect(copy.data.owner.id).toBe(reader.id);
    expect(copy.data.papers).toHaveLength(3);
    expect(copy.data.collaborators).toEqual([]);
    expect(copy.data.stars).toBe(0);
    expect(copy.data.progress.completed).toEqual([]);
    expect(
      (await call(`/comments?folderId=${fork.data.id}`, reader)).data.comments,
    ).toEqual([]);
    await call(`/folders/${id}`, owner, "PATCH", {
      revision: f.data.revision,
      visibility: "private",
    });
    expect((await call("/folders?scope=starred", reader)).data.folders).toEqual(
      [],
    );
    expect(
      (await call(`/folders/${fork.data.id}`, reader)).data.forkedFrom,
    ).toBeNull();
    expect((await call(`/folders/${id}/fork`, reader, "POST", {})).status).toBe(
      404,
    );
  });
  it("checks source-folder access on copying and preserves target state on failure", async () => {
    const privateId = await folder();
    await add(privateId);
    const publicId = await folder("public");
    let target = await call(
      `/folders/${publicId}/collaborators`,
      owner,
      "PUT",
      { revision: 1, userId: reader.id, add: true },
    );
    const denied = await call(`/folders/${publicId}/papers`, reader, "POST", {
      revision: target.data.revision,
      sourceFolder: privateId,
      paperIds: [papers[0].id],
    });
    expect(denied.status).toBe(404);
    expect((await call(`/folders/${publicId}`)).data.paperCount).toBe(0);
  });
  it("copies an accessible source in the requested order and rejects a stale source selection atomically", async () => {
    const source = await folder("public");
    await add(source);
    const target = await folder();
    let destination = await add(target, [papers[2].id]);
    const copy = await call(`/folders/${target}/papers`, owner, "POST", {
      revision: destination.data.revision,
      sourceFolder: source,
      paperIds: [papers[1].id, papers[0].id, papers[2].id],
      afterId: null,
    });
    expect(copy.status).toBe(200);
    expect(copy.data.papers.map((p: any) => p.id)).toEqual([
      papers[1].id,
      papers[0].id,
      papers[2].id,
    ]);
    const currentSource = await call(`/folders/${source}`);
    await call(`/folders/${source}/papers`, owner, "DELETE", {
      revision: currentSource.data.revision,
      paperIds: [papers[0].id],
    });
    const stale = await call(`/folders/${target}/papers`, owner, "POST", {
      revision: copy.data.revision,
      sourceFolder: source,
      paperIds: [papers[0].id, papers[1].id],
    });
    expect(stale.status).toBe(400);
    destination = await call(`/folders/${target}`);
    expect(destination.data.revision).toBe(copy.data.revision);
    expect(destination.data.papers).toEqual(copy.data.papers);
  });
});
describe("discussion, ratings and topics", () => {
  it("shows recent paper comments to members, excluding all folder discussions and deleted comments", async () => {
    const privateFolder = await folder(),
      publicFolder = await folder("public");
    for (const folderId of [privateFolder, publicFolder])
      await call("/comments", owner, "POST", {
        folderId,
        body: "Folder-only conversation",
      });
    const ids: string[] = [];
    for (let n = 0; n < 23; n++) {
      const c = await call("/comments", n % 2 ? owner : reader, "POST", {
        paperId: papers[n % 2].id,
        body: `Paper observation ${n}`,
      });
      expect(c.status).toBe(201);
      ids.push(c.data.id);
      db.run(
        "UPDATE comments SET created_at=? WHERE id=?",
        1000 + n,
        c.data.id,
      );
    }
    let feed = await call("/community/comments", outsider);
    expect(feed.data.total).toBe(23);
    expect(feed.data.comments.map((c: any) => c.id)).toEqual(
      [...ids].reverse().slice(0, 20),
    );
    expect(feed.data.comments[0].paper.title).toBe(papers[0].title);
    expect(JSON.stringify(feed.data)).not.toContain("Folder-only");
    const older = await call("/community/comments?offset=20", outsider);
    expect(older.data.comments.map((c: any) => c.id)).toEqual(
      [...ids].reverse().slice(20),
    );
    await call(`/comments/${ids[22]}`, reader, "PATCH", {
      revision: 1,
      body: "Revised observation",
    });
    feed = await call("/community/comments", outsider);
    expect(feed.data.comments[0].body).toBe("Revised observation");
    expect(feed.data.comments[0].canEdit).toBe(false);
    await call(`/comments/${ids[22]}`, reader, "DELETE", { revision: 2 });
    expect((await call("/community/comments")).data.total).toBe(22);
  });
  it("merges activity before pagination, pins open proposals and reflects adoption", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) {
      const comment = await call("/comments", owner, "POST", {
        paperId: papers[i % papers.length].id,
        body: `Observation ${i}`,
      });
      expect(comment.status).toBe(201);
      ids.push(comment.data.id);
      db.run(
        "UPDATE comments SET created_at=? WHERE id=?",
        1000 + 2 * i,
        comment.data.id,
      );
    }
    for (const visibility of ["private", "public"]) {
      const id = await folder(visibility);
      await call("/comments", owner, "POST", {
        folderId: id,
        body: "Folder-only conversation",
      });
    }
    const adopted = await proposal();
    for (const user of [owner, reader, editor])
      await call(`/proposals/${adopted}/vote`, user, "POST", { choice: "yes" });
    db.run("UPDATE topic_proposals SET created_at=? WHERE id=?", 1011, adopted);
    const open = await call(
      `/papers/${papers[1].id}/proposals`,
      owner,
      "POST",
      {
        revision: 0,
        topics: ["Network emulation"],
        reason: "The abstract focuses on emulating network behavior.",
      },
    );
    expect(open.status).toBe(201);
    db.run(
      "UPDATE topic_proposals SET created_at=? WHERE id=?",
      500,
      open.data.id,
    );
    const first = (await call("/community")).data;
    const second = (await call("/community?offset=20")).data;
    expect(first.total).toBe(24);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(4);
    expect(first.items[0].proposal.id).toBe(open.data.id);
    expect(first.items[1].comment.id).toBe(ids[21]);
    const merged = [...first.items, ...second.items];
    const activity = (item: any) =>
      item.type === "comment" ? item.comment : item.proposal;
    expect(new Set(merged.map((item) => activity(item).id)).size).toBe(24);
    const dates = merged.slice(1).map((item) => activity(item).createdAt);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(JSON.stringify(merged)).not.toContain("Folder-only conversation");
    expect((await call("/community?offset=999")).data.offset).toBe(20);
    await call(`/comments/${ids[21]}`, owner, "PATCH", {
      revision: 1,
      body: "Revised observation",
    });
    expect((await call("/community")).data.items[1].comment.body).toBe(
      "Revised observation",
    );
    await call(`/comments/${ids[21]}`, owner, "DELETE", { revision: 2 });
    expect((await call("/community")).data.total).toBe(23);
    for (const user of [owner, reader, editor])
      await call(`/proposals/${open.data.id}/vote`, user, "POST", {
        choice: "yes",
      });
    const finalFirst = (await call("/community")).data;
    const finalLast = (await call("/community?offset=20")).data.items.at(-1);
    expect(finalFirst.items[0].comment.id).toBe(ids[20]);
    expect(finalLast.proposal.id).toBe(open.data.id);
    expect(finalLast.proposal.status).toBe("adopted");
  });
  it("keeps open topic proposals separate from completed history with pagination", async () => {
    const adopted = await proposal(["Transport, congestion control and RDMA"]);
    for (const user of [owner, reader, editor])
      await call(`/proposals/${adopted}/vote`, user, "POST", { choice: "yes" });
    expect((await call(`/papers/${papers[0].id}`)).data.topics).toHaveLength(1);
    for (let n = 0; n < 22; n++)
      expect(
        (
          await call(`/papers/${papers[1].id}/proposals`, owner, "POST", {
            revision: 0,
            topics: [`Candidate ${n}`],
            reason: `Research rationale ${n}`,
          })
        ).status,
      ).toBe(201);
    const pending = await call("/community/proposals");
    expect(pending.data.total).toBe(22);
    expect(pending.data.proposals).toHaveLength(20);
    expect(pending.data.proposals.every((p: any) => p.status === "open")).toBe(
      true,
    );
    const next = await call("/community/proposals?offset=20");
    expect(next.data.proposals).toHaveLength(2);
    expect(
      new Set(
        [...pending.data.proposals, ...next.data.proposals].map(
          (p: any) => p.id,
        ),
      ).size,
    ).toBe(22);
    const history = await call("/community/proposals?status=closed");
    expect(history.data.total).toBe(1);
    expect(history.data.proposals[0].id).toBe(adopted);
    expect((await call("/community/proposals?status=bad")).status).toBe(400);
  });
  it("supports editing/removing only your comments and inherits target privacy", async () => {
    const id = await folder("public");
    const c = await call("/comments", reader, "POST", {
      folderId: id,
      body: "<script>alert(1)</script> stays text",
    });
    expect(c.status).toBe(201);
    expect(
      (
        await call(`/comments/${c.data.id}`, owner, "PATCH", {
          revision: 1,
          body: "Changed",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(`/comments/${c.data.id}`, reader, "PATCH", {
          revision: 1,
          body: "Updated observation",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`/comments/${c.data.id}`, reader, "PATCH", {
          revision: 1,
          body: "Stale",
        })
      ).status,
    ).toBe(409);
    await call(`/folders/${id}`, owner, "PATCH", {
      revision: 1,
      visibility: "private",
    });
    expect((await call(`/comments?folderId=${id}`, reader)).status).toBe(404);
    expect(
      (await call(`/comments/${c.data.id}`, reader, "DELETE", { revision: 2 }))
        .status,
    ).toBe(404);
    const own = await call("/comments", reader, "POST", {
      paperId: papers[0].id,
      body: "Paper discussion",
    });
    expect(
      (
        await call(`/comments/${own.data.id}`, reader, "DELETE", {
          revision: 1,
        })
      ).status,
    ).toBe(200);
  });
  it("upserts ratings, aggregates users, and clears without adding a duplicate vote", async () => {
    const path = `/papers/${papers[0].id}/rating`;
    await call(path, owner, "PUT", { score: 5 });
    await call(path, owner, "PUT", { score: 3 });
    await call(path, reader, "PUT", { score: 5 });
    let p = await call(`/papers/${papers[0].id}`);
    expect(p.data.rating).toBe(4);
    expect(p.data.ratingCount).toBe(2);
    expect(p.data.myRating).toBe(3);
    await call(path, owner, "PUT", { score: null });
    p = await call(`/papers/${papers[0].id}`);
    expect(p.data.rating).toBe(5);
    expect(p.data.ratingCount).toBe(1);
    expect(p.data.myRating).toBeNull();
    expect((await call(path, owner, "PUT", { score: 6 })).status).toBe(400);
  });
  it("requires strictly more than half of all users and records the adoption denominator", async () => {
    const id = await proposal();
    await call(`/proposals/${id}/vote`, owner, "POST", { choice: "yes" });
    await call(`/proposals/${id}/vote`, reader, "POST", { choice: "yes" });
    expect((await call("/proposals")).data.proposals[0].status).toBe("open");
    await call(`/proposals/${id}/vote`, editor, "POST", { choice: "yes" });
    const p = (await call("/proposals")).data.proposals[0];
    expect(p.status).toBe("adopted");
    expect(p.adoptedUsers).toBe(4);
    expect(p.adoptedYes).toBe(3);
    expect((await call(`/papers/${papers[0].id}`)).data.topics[0].name).toBe(
      "Congestion Control",
    );
    expect(
      (await call(`/proposals/${id}/vote`, outsider, "POST", { choice: "no" }))
        .status,
    ).toBe(409);
  });
  it("changes/withdraws one vote, counts membership growth and supersedes competing proposals", async () => {
    const a = await proposal(["Transport"]),
      b = await proposal(["Distributed Systems"]);
    await call(`/proposals/${a}/vote`, owner, "POST", { choice: "yes" });
    await call(`/proposals/${a}/vote`, owner, "POST", { choice: "no" });
    await call(`/proposals/${a}/vote`, owner, "POST", { choice: null });
    let p = (await call("/proposals")).data.proposals.find(
      (p: any) => p.id === a,
    );
    expect(p.yes + p.no).toBe(0);
    db.transaction(() => {
      insertUser(db, "fifth", "Fifth");
      insertUser(db, "sixth", "Sixth");
      evaluateProposals(db);
    });
    for (const user of [owner, editor, reader])
      await call(`/proposals/${a}/vote`, user, "POST", { choice: "yes" });
    expect(
      (await call("/proposals")).data.proposals.find((p: any) => p.id === a)
        .status,
    ).toBe("open");
    await call(`/proposals/${a}/vote`, outsider, "POST", { choice: "yes" });
    const all = (await call("/proposals")).data.proposals;
    expect(all.find((p: any) => p.id === a).status).toBe("adopted");
    expect(all.find((p: any) => p.id === b).status).toBe("superseded");
    expect(
      (
        await call(`/papers/${papers[0].id}/proposals`, reader, "POST", {
          revision: 0,
          topics: ["Storage"],
          reason: "An old base",
        })
      ).status,
    ).toBe(409);
  });
  it("imports topics once, validates unknown IDs atomically and preserves them on sync", () => {
    const seed = {
      version: 1,
      topics: [{ id: "networks", name: "Networks" }],
      papers: [{ id: papers[0].id, topics: ["networks"] }],
    };
    expect(() =>
      importTopics(db, {
        ...seed,
        papers: [{ id: "invalid", topics: ["networks"] }],
      }),
    ).toThrow();
    expect(db.all("SELECT * FROM topics")).toEqual([]);
    importTopics(db, seed);
    expect(() => importTopics(db, seed)).toThrow(/initialized/);
    syncCorpus(db, papers);
    expect(db.all("SELECT * FROM paper_topics")).toHaveLength(1);
  });
  it("does not reinterpret a pending topic name after another paper claims its identifier", async () => {
    const first = await proposal(["Storage Systems"]);
    const second = await call(
      `/papers/${papers[1].id}/proposals`,
      owner,
      "POST",
      {
        revision: 0,
        topics: ["Storage-Systems"],
        reason: "A distinct proposed topic name.",
      },
    );
    expect(second.status).toBe(201);
    for (const id of [first, second.data.id])
      for (const user of [owner, editor, reader])
        await call(`/proposals/${id}/vote`, user, "POST", { choice: "yes" });
    const all = (await call("/proposals")).data.proposals;
    expect(all.find((p: any) => p.id === first).status).toBe("adopted");
    expect(all.find((p: any) => p.id === second.data.id).status).toBe(
      "superseded",
    );
    expect((await call(`/papers/${papers[1].id}`)).data.topics).toEqual([]);
    db.transaction(() => {
      for (let n = 0; n < 4; n++)
        insertUser(db, `late${n}`, `Late member ${n}`);
      evaluateProposals(db);
    });
    const retained = (await call("/proposals")).data.proposals.find(
      (p: any) => p.id === first,
    );
    expect(retained.status).toBe("adopted");
    expect(retained.adoptedUsers).toBe(4);
    expect(retained.adoptedYes).toBe(3);
  });
  it("uses issuer/subject for identities and requires explicit linking", () => {
    const external = resolveIdentity(
      db,
      config,
      { issuer: "https://id.example", subject: "a", name: "OWNER" },
      null,
      null,
    );
    expect(external.id).not.toBe(owner.id);
    expect(
      resolveIdentity(
        db,
        config,
        { issuer: "https://id.example", subject: "a" },
        null,
        null,
      ).id,
    ).toBe(external.id);
    expect(() =>
      resolveIdentity(
        db,
        config,
        { issuer: "https://id.example", subject: "a" },
        owner.id,
        null,
      ),
    ).toThrow(/another account/);
    expect(
      resolveIdentity(
        db,
        config,
        { issuer: "https://id.example", subject: "b" },
        owner.id,
        null,
      ).id,
    ).toBe(owner.id);
    const closed = { ...config, registration: "closed" as const };
    expect(() =>
      resolveIdentity(
        db,
        closed,
        { issuer: "https://id.example", subject: "c" },
        null,
        null,
      ),
    ).toThrow();
  });
});
it("reopens a persisted database and syncs content without deleting activity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paperclub-test-")),
    path = join(dir, "app.sqlite");
  let disk = new Store(path).migrate();
  try {
    syncCorpus(disk, papers);
    const user = insertUser(disk, "persistent", "Persistent");
    disk.run("INSERT INTO ratings VALUES (?,?,?)", user.id, papers[0].id, 4);
    disk.close();
    disk = new Store(path).migrate();
    syncCorpus(disk, [{ ...papers[0], title: "Updated title" }]);
    expect(
      disk.get<{ score: number }>("SELECT score FROM ratings")!.score,
    ).toBe(4);
    expect(
      disk.get<{ available: number }>(
        "SELECT available FROM papers WHERE id=?",
        papers[1].id,
      )!.available,
    ).toBe(0);
    expect(
      disk.get<{ title: string }>(
        "SELECT title FROM papers WHERE id=?",
        papers[0].id,
      )!.title,
    ).toBe("Updated title");
  } finally {
    disk.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("sorts deterministically without mutating the original sequence", async () => {
  const result = await call("/papers");
  const original = result.data.papers;
  const ids = original.map((p: any) => p.id);
  expect(sortPapers(original, "random", 17).map((p) => p.id)).toEqual(
    sortPapers(original, "random", 17).map((p) => p.id),
  );
  expect(original.map((p: any) => p.id)).toEqual(ids);
  expect(sortPapers(original, "oldest").map((p) => p.year)).toEqual(
    original.map((p: any) => p.year).sort((a: number, b: number) => a - b),
  );
});
it("combines multi-select facets with OR within each facet and AND across facets", async () => {
  const samples = papers.slice(0, 4).map((p, n) => ({
    ...p,
    conference: n % 2 ? "SIGCOMM" : "NSDI",
    year: 2020 + Math.floor(n / 2),
  }));
  syncCorpus(db, samples);
  const both = await call(
    "/papers?conference=NSDI&conference=SIGCOMM&year=2020",
  );
  expect(new Set(both.data.ids)).toEqual(
    new Set(samples.slice(0, 2).map((p) => p.id)),
  );
  const years = await call("/papers?conference=NSDI&year=2020&year=2021");
  expect(new Set(years.data.ids)).toEqual(
    new Set([samples[0].id, samples[2].id]),
  );
  importTopics(db, {
    version: 1,
    topics: [
      { id: "alpha", name: "Alpha" },
      { id: "beta", name: "Beta" },
    ],
    papers: [
      { id: samples[0].id, topics: ["alpha"] },
      { id: samples[1].id, topics: ["beta"] },
    ],
  });
  const topics = await call("/papers?topic=alpha&topic=beta&conference=NSDI");
  expect(topics.data.ids).toEqual([samples[0].id]);
});
