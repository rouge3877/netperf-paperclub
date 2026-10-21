import { randomUUID } from "node:crypto";
import type { Store } from "./db.ts";
import type { User, Comment, PaperComment } from "../shared/types.ts";
import { accessFolder } from "./folders.ts";
import { check, text } from "./errors.ts";
type Target = { paperId?: string; folderId?: string };
export function recentPaperComments(db: Store, user: User, offset = 0) {
  const total = db.get<{ n: number }>(
    "SELECT count(*) n FROM comments WHERE paper_id IS NOT NULL",
  )!.n;
  const ids = db
    .all<{ id: string }>(
      "SELECT id FROM comments WHERE paper_id IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?",
      Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0,
    )
    .map((row) => row.id);
  return { comments: paperCommentsByIds(db, user, ids), total };
}
export function paperCommentsByIds(
  db: Store,
  user: User,
  ids: string[],
): PaperComment[] {
  if (!ids.length) return [];
  const comments = db
    .all<{
      id: string;
      author_id: string;
      username: string;
      display_name: string;
      body: string;
      created_at: number;
      updated_at: number;
      revision: number;
      paper_id: string;
      title: string;
      conference: string;
      year: number;
    }>(
      `SELECT c.*,u.username,u.display_name,p.title,p.conference,p.year
     FROM comments c JOIN users u ON u.id=c.author_id JOIN papers p ON p.id=c.paper_id
     WHERE c.paper_id IS NOT NULL AND c.id IN (${ids.map(() => "?").join(",")})`,
      ...ids,
    )
    .map((c): PaperComment => ({
      id: c.id,
      body: c.body,
      author: {
        id: c.author_id,
        username: c.username,
        displayName: c.display_name,
      },
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      revision: c.revision,
      canEdit: c.author_id === user.id,
      paper: {
        id: c.paper_id,
        title: c.title,
        conference: c.conference,
        year: c.year,
      },
    }));
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}
function target(db: Store, user: User, input: Target) {
  check(
    !!input.paperId !== !!input.folderId,
    400,
    "Choose one comment target.",
  );
  if (input.folderId) accessFolder(db, user, input.folderId);
  else
    check(
      db.get("SELECT 1 FROM papers WHERE id=?", input.paperId!),
      404,
      "Paper not found.",
    );
}
export function listComments(db: Store, user: User, input: Target, offset = 0) {
  target(db, user, input);
  const field = input.folderId ? "folder_id" : "paper_id",
    id = input.folderId || input.paperId!;
  const total = db.get<{ n: number }>(
    `SELECT count(*) n FROM comments WHERE ${field}=?`,
    id,
  )!.n;
  const comments = db
    .all<{
      id: string;
      author_id: string;
      username: string;
      display_name: string;
      body: string;
      created_at: number;
      updated_at: number;
      revision: number;
    }>(
      `SELECT c.*,u.username,u.display_name FROM comments c JOIN users u ON u.id=c.author_id WHERE c.${field}=? ORDER BY c.created_at,c.id LIMIT 50 OFFSET ?`,
      id,
      Math.max(0, Math.floor(offset) || 0),
    )
    .map((c) => ({
      id: c.id,
      body: c.body,
      author: {
        id: c.author_id,
        username: c.username,
        displayName: c.display_name,
      },
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      revision: c.revision,
      canEdit: c.author_id === user.id,
    })) satisfies Comment[];
  return { comments, total };
}
export function addComment(
  db: Store,
  user: User,
  input: Record<string, unknown>,
) {
  const t = {
    paperId: typeof input.paperId === "string" ? input.paperId : undefined,
    folderId: typeof input.folderId === "string" ? input.folderId : undefined,
  };
  return db.transaction(() => {
    target(db, user, t);
    check(
      db.get<{ n: number }>(
        "SELECT count(*) n FROM comments WHERE author_id=? AND created_at>?",
        user.id,
        Date.now() - 60000,
      )!.n < 20,
      429,
      "Please wait before posting more comments.",
    );
    const id = randomUUID(),
      now = Date.now();
    db.run(
      "INSERT INTO comments(id,author_id,paper_id,folder_id,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      id,
      user.id,
      t.paperId ?? null,
      t.folderId ?? null,
      text(input.body, "Comment", 5000),
      now,
      now,
    );
    return { id };
  });
}
export function changeComment(
  db: Store,
  user: User,
  id: string,
  input: Record<string, unknown>,
  remove = false,
) {
  db.transaction(() => {
    const c = db.get<{
      author_id: string;
      paper_id: string | null;
      folder_id: string | null;
      revision: number;
    }>("SELECT * FROM comments WHERE id=?", id);
    check(c, 404, "Comment not found.");
    target(db, user, {
      paperId: c.paper_id ?? undefined,
      folderId: c.folder_id ?? undefined,
    });
    check(
      c.author_id === user.id,
      403,
      "You can only manage your own comments.",
    );
    check(
      input.revision === c.revision,
      409,
      "This comment changed. Refresh before editing.",
      "revision_conflict",
    );
    if (remove) db.run("DELETE FROM comments WHERE id=?", id);
    else
      db.run(
        "UPDATE comments SET body=?,revision=revision+1,updated_at=? WHERE id=?",
        text(input.body, "Comment", 5000),
        Date.now(),
        id,
      );
  });
}
