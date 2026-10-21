import { randomUUID } from "node:crypto";
import type { Store } from "./db.ts";
import type { User, Folder, FolderDetail, Progress } from "../shared/types.ts";
import { check, text, ids, flag } from "./errors.ts";
import { listPapers } from "./papers.ts";
export interface FolderRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  ordered: number;
  visibility: "private" | "public";
  revision: number;
  created_at: number;
  updated_at: number;
  forked_from: string | null;
}
export function accessFolder(
  db: Store,
  user: User,
  id: string,
  edit = false,
): FolderRow {
  const row = db.get<FolderRow>("SELECT * FROM folders WHERE id=?", id);
  const collaborator =
    !!row &&
    !!db.get(
      "SELECT 1 FROM folder_collaborators WHERE folder_id=? AND user_id=?",
      id,
      user.id,
    );
  check(
    row &&
      (row.visibility === "public" || row.owner_id === user.id || collaborator),
    404,
    "Folder not found.",
  );
  if (edit)
    check(
      row.owner_id === user.id || collaborator,
      403,
      "Only the owner or a collaborator can edit this folder.",
    );
  return row;
}
function userById(db: Store, id: string) {
  return db.get<User>(
    "SELECT id,username,display_name AS displayName FROM users WHERE id=?",
    id,
  )!;
}
function summary(db: Store, user: User, row: FolderRow): Folder {
  let forkedFrom: Folder["forkedFrom"] = null;
  if (row.forked_from) {
    try {
      const source = accessFolder(db, user, row.forked_from);
      forkedFrom = {
        id: source.id,
        name: source.name,
        owner: userById(db, source.owner_id).displayName,
      };
    } catch {
      /* Private lineage must not leak. */
    }
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ordered: !!row.ordered,
    visibility: row.visibility,
    owner: userById(db, row.owner_id),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paperCount: db.get<{ n: number }>(
      "SELECT count(*) n FROM folder_items WHERE folder_id=?",
      row.id,
    )!.n,
    stars: db.get<{ n: number }>(
      "SELECT count(*) n FROM folder_stars WHERE folder_id=?",
      row.id,
    )!.n,
    starred: !!db.get(
      "SELECT 1 FROM folder_stars WHERE folder_id=? AND user_id=?",
      row.id,
      user.id,
    ),
    isOwner: row.owner_id === user.id,
    canEdit:
      row.owner_id === user.id ||
      !!db.get(
        "SELECT 1 FROM folder_collaborators WHERE folder_id=? AND user_id=?",
        row.id,
        user.id,
      ),
    forkedFrom,
  };
}
export function listFolders(db: Store, user: User, scope: string): Folder[] {
  check(
    ["mine", "public", "starred"].includes(scope),
    400,
    "Invalid folder view.",
  );
  const conditions =
    scope === "mine"
      ? "(owner_id=? OR id IN (SELECT folder_id FROM folder_collaborators WHERE user_id=?))"
      : scope === "public"
        ? "visibility='public'"
        : "visibility='public' AND id IN (SELECT folder_id FROM folder_stars WHERE user_id=?)";
  return db
    .all<FolderRow>(
      `SELECT * FROM folders WHERE ${conditions} ORDER BY updated_at DESC,id`,
      ...(scope === "mine"
        ? [user.id, user.id]
        : scope === "starred"
          ? [user.id]
          : []),
    )
    .map((r) => summary(db, user, r));
}
export function memberIds(db: Store, id: string): string[] {
  return db
    .all<{ paper_id: string }>(
      "SELECT paper_id FROM folder_items WHERE folder_id=? ORDER BY position",
      id,
    )
    .map((p) => p.paper_id);
}
export function progress(db: Store, user: User, row: FolderRow): Progress {
  const members = new Set(memberIds(db, row.id));
  const completed = db
    .all<{ paper_id: string }>(
      "SELECT paper_id FROM reading_completed WHERE user_id=? AND folder_id=?",
      user.id,
      row.id,
    )
    .map((p) => p.paper_id)
    .filter((id) => members.has(id));
  const saved = db.get<{ paper_id: string | null }>(
    "SELECT paper_id FROM reading_positions WHERE user_id=? AND folder_id=?",
    user.id,
    row.id,
  )?.paper_id;
  return {
    completed,
    currentPaperId:
      saved && members.has(saved)
        ? saved
        : ([...members].find((id) => !completed.includes(id)) ??
          [...members][0] ??
          null),
  };
}
export function getFolder(db: Store, user: User, id: string): FolderDetail {
  const row = accessFolder(db, user, id);
  const byId = new Map(listPapers(db, user).map((p) => [p.id, p]));
  return {
    ...summary(db, user, row),
    papers: db
      .all<{ paper_id: string; note: string }>(
        "SELECT paper_id,note FROM folder_items WHERE folder_id=? ORDER BY position",
        id,
      )
      .map((item) => ({ ...byId.get(item.paper_id)!, note: item.note })),
    collaborators: db.all<User>(
      "SELECT u.id,u.username,u.display_name AS displayName FROM folder_collaborators c JOIN users u ON u.id=c.user_id WHERE c.folder_id=? ORDER BY u.display_name",
      id,
    ),
    progress: row.ordered ? progress(db, user, row) : null,
  };
}
function insertFolder(
  db: Store,
  user: User,
  input: Record<string, unknown>,
  source: string | null = null,
) {
  const id = randomUUID(),
    now = Date.now();
  const visibility = input.visibility ?? "private";
  check(
    visibility === "private" || visibility === "public",
    400,
    "Choose private or public.",
  );
  db.run(
    "INSERT INTO folders(id,owner_id,name,description,ordered,visibility,created_at,updated_at,forked_from) VALUES (?,?,?,?,?,?,?,?,?)",
    id,
    user.id,
    text(input.name, "Folder name", 120),
    text(input.description ?? "", "Description", 3000, 0),
    Number(flag(input.ordered, "Ordered")),
    visibility,
    now,
    now,
    source,
  );
  return id;
}
export function createFolder(
  db: Store,
  user: User,
  input: Record<string, unknown>,
) {
  return db.transaction(() => {
    check(
      db.get<{ n: number }>(
        "SELECT count(*) n FROM folders WHERE owner_id=?",
        user.id,
      )!.n < 500,
      400,
      "You have reached the folder limit.",
    );
    return { id: insertFolder(db, user, input) };
  });
}
function mutate(
  db: Store,
  user: User,
  id: string,
  revision: unknown,
  fn: (row: FolderRow) => void,
  owner = false,
) {
  db.transaction(() => {
    const row = accessFolder(db, user, id, true);
    if (owner)
      check(
        row.owner_id === user.id,
        403,
        "Only the owner can perform this action.",
      );
    check(
      revision === row.revision,
      409,
      "This folder changed. Refresh it before applying your changes.",
      "revision_conflict",
    );
    fn(row);
    db.run(
      "UPDATE folders SET revision=revision+1,updated_at=? WHERE id=?",
      Date.now(),
      id,
    );
  });
}
export function updateFolder(
  db: Store,
  user: User,
  id: string,
  input: Record<string, unknown>,
) {
  mutate(db, user, id, input.revision, (row) => {
    let visibility = row.visibility;
    if (input.visibility !== undefined) {
      check(
        row.owner_id === user.id,
        403,
        "Only the owner can change visibility.",
      );
      check(
        input.visibility === "public" || input.visibility === "private",
        400,
        "Invalid visibility.",
      );
      visibility = input.visibility;
    }
    db.run(
      "UPDATE folders SET name=?,description=?,visibility=? WHERE id=?",
      input.name === undefined
        ? row.name
        : text(input.name, "Folder name", 120),
      input.description === undefined
        ? row.description
        : text(input.description, "Description", 3000, 0),
      visibility,
      id,
    );
  });
}
export function deleteFolder(
  db: Store,
  user: User,
  id: string,
  revision: unknown,
) {
  mutate(
    db,
    user,
    id,
    revision,
    () => {
      db.run("DELETE FROM folders WHERE id=?", id);
    },
    true,
  );
}
function replaceItems(db: Store, id: string, members: string[]) {
  check(
    members.length <= 5000,
    400,
    "A folder can contain at most 5,000 papers.",
  );
  const retained = new Set(members);
  for (const paper of memberIds(db, id))
    if (!retained.has(paper))
      db.run(
        "DELETE FROM folder_items WHERE folder_id=? AND paper_id=?",
        id,
        paper,
      );
  // Temporary positions avoid uniqueness collisions while keeping item notes.
  db.run("UPDATE folder_items SET position=-position-1 WHERE folder_id=?", id);
  members.forEach((paper, index) =>
    db.run(
      `INSERT INTO folder_items(folder_id,paper_id,position) VALUES (?,?,?)
       ON CONFLICT(folder_id,paper_id) DO UPDATE SET position=excluded.position`,
      id,
      paper,
      index,
    ),
  );
}
export function updateNote(
  db: Store,
  user: User,
  id: string,
  paperId: string,
  input: Record<string, unknown>,
) {
  mutate(db, user, id, input.revision, () => {
    check(
      db.get(
        "SELECT 1 FROM folder_items WHERE folder_id=? AND paper_id=?",
        id,
        paperId,
      ),
      404,
      "This paper is no longer in the folder.",
    );
    db.run(
      "UPDATE folder_items SET note=? WHERE folder_id=? AND paper_id=?",
      text(input.note, "Note", 5000, 0),
      id,
      paperId,
    );
  });
}
export function addPapers(
  db: Store,
  user: User,
  id: string,
  input: Record<string, unknown>,
) {
  const incoming = ids(input.paperIds);
  check(incoming.length, 400, "Choose at least one paper.");
  mutate(db, user, id, input.revision, (row) => {
    if (input.sourceFolder) {
      const source = accessFolder(
        db,
        user,
        text(input.sourceFolder, "Source folder"),
      );
      const allowed = new Set(memberIds(db, source.id));
      check(
        incoming.every((p) => allowed.has(p)),
        400,
        "The source folder changed. Choose its current papers.",
      );
    }
    for (const paper of incoming)
      check(
        db.get("SELECT 1 FROM papers WHERE id=? AND available=1", paper),
        400,
        "One or more papers are unavailable.",
      );
    const current = memberIds(db, id),
      known = new Set(current),
      added = incoming.filter((p) => !known.has(p));
    let index = current.length;
    if (row.ordered && input.afterId !== undefined) {
      if (input.afterId === null) index = 0;
      else {
        index = current.indexOf(String(input.afterId));
        check(index >= 0, 409, "The insertion point changed.");
        index++;
      }
    }
    replaceItems(db, id, [
      ...current.slice(0, index),
      ...added,
      ...current.slice(index),
    ]);
  });
}
export function removePapers(
  db: Store,
  user: User,
  id: string,
  input: Record<string, unknown>,
) {
  const remove = new Set(ids(input.paperIds));
  mutate(db, user, id, input.revision, () =>
    replaceItems(
      db,
      id,
      memberIds(db, id).filter((p) => !remove.has(p)),
    ),
  );
}
export function reorder(
  db: Store,
  user: User,
  id: string,
  input: Record<string, unknown>,
) {
  const ordered = ids(input.paperIds);
  check(
    Array.isArray(input.paperIds) && ordered.length === input.paperIds.length,
    400,
    "Order must not contain duplicates.",
  );
  mutate(db, user, id, input.revision, (row) => {
    check(
      row.ordered,
      400,
      "This folder is unordered. Sorting is a display preference.",
    );
    const current = memberIds(db, id);
    const expected = new Set(current);
    check(
      current.length === ordered.length &&
        ordered.every((p) => expected.has(p)),
      409,
      "Order must contain every current paper exactly once.",
    );
    replaceItems(db, id, ordered);
  });
}
export function collaborate(
  db: Store,
  user: User,
  id: string,
  input: Record<string, unknown>,
) {
  const target = text(input.userId, "Collaborator");
  const add = flag(input.add, "Add collaborator");
  mutate(
    db,
    user,
    id,
    input.revision,
    (row) => {
      check(target !== row.owner_id, 400, "The owner already has access.");
      check(
        db.get("SELECT 1 FROM users WHERE id=?", target),
        404,
        "User not found.",
      );
      if (add)
        db.run(
          "INSERT OR IGNORE INTO folder_collaborators VALUES (?,?)",
          id,
          target,
        );
      else
        db.run(
          "DELETE FROM folder_collaborators WHERE folder_id=? AND user_id=?",
          id,
          target,
        );
    },
    true,
  );
}
export function forkFolder(
  db: Store,
  user: User,
  id: string,
  input: Record<string, unknown>,
) {
  return db.transaction(() => {
    const row = accessFolder(db, user, id);
    check(
      row.visibility === "public" || row.owner_id === user.id,
      403,
      "Only public folders or your own folders can be copied.",
    );
    check(
      db.get<{ n: number }>(
        "SELECT count(*) n FROM folders WHERE owner_id=?",
        user.id,
      )!.n < 500,
      400,
      "You have reached the folder limit.",
    );
    const fork = insertFolder(
      db,
      user,
      {
        name: input.name ?? `${row.name} (copy)`,
        description: row.description,
        ordered: input.ordered ?? !!row.ordered,
        visibility: "private",
      },
      id,
    );
    db.run(
      `INSERT INTO folder_items(folder_id,paper_id,position,note)
       SELECT ?,paper_id,position,note FROM folder_items WHERE folder_id=?`,
      fork,
      id,
    );
    return { id: fork };
  });
}
export function starFolder(db: Store, user: User, id: string, value: unknown) {
  db.transaction(() => {
    const row = accessFolder(db, user, id);
    check(
      row.visibility === "public",
      400,
      "Only public folders can be starred.",
    );
    if (flag(value, "Starred"))
      db.run("INSERT OR IGNORE INTO folder_stars VALUES (?,?)", id, user.id);
    else
      db.run(
        "DELETE FROM folder_stars WHERE folder_id=? AND user_id=?",
        id,
        user.id,
      );
  });
}
export function updateProgress(
  db: Store,
  user: User,
  id: string,
  input: Record<string, unknown>,
) {
  return db.transaction(() => {
    const row = accessFolder(db, user, id);
    check(row.ordered, 400, "Only ordered folders track reading progress.");
    const paper = text(input.paperId, "Paper");
    check(
      db.get(
        "SELECT 1 FROM folder_items WHERE folder_id=? AND paper_id=?",
        id,
        paper,
      ),
      409,
      "This paper is no longer in the folder.",
    );
    if (input.completed !== undefined) {
      if (flag(input.completed, "Completed"))
        db.run(
          "INSERT INTO reading_completed VALUES (?,?,?,?) ON CONFLICT(user_id,folder_id,paper_id) DO NOTHING",
          user.id,
          id,
          paper,
          Date.now(),
        );
      else
        db.run(
          "DELETE FROM reading_completed WHERE user_id=? AND folder_id=? AND paper_id=?",
          user.id,
          id,
          paper,
        );
    }
    if (input.current === true)
      db.run(
        "INSERT INTO reading_positions VALUES (?,?,?,?) ON CONFLICT(user_id,folder_id) DO UPDATE SET paper_id=excluded.paper_id,updated_at=excluded.updated_at",
        user.id,
        id,
        paper,
        Date.now(),
      );
    return progress(db, user, row);
  });
}
