import type {
  CommunityActivity,
  CommunityFeed,
  User,
} from "../shared/types.ts";
import type { Store } from "./db.ts";
import { paperCommentsByIds } from "./comments.ts";
import { proposalsByIds } from "./topics.ts";

// Sort before pagination so neither kind of activity can hide the other.
export function communityFeed(
  db: Store,
  user: User,
  requestedOffset = 0,
): CommunityFeed {
  const total = db.get<{ n: number }>(
    `SELECT (SELECT count(*) FROM comments WHERE paper_id IS NOT NULL)
      + (SELECT count(*) FROM topic_proposals) AS n`,
  )!.n;
  const offset = Math.min(
    Number.isFinite(requestedOffset)
      ? Math.max(0, Math.floor(requestedOffset))
      : 0,
    Math.max(0, Math.ceil(total / 20) - 1) * 20,
  );
  const rows = db.all<{ id: string; type: "comment" | "proposal" }>(
    `SELECT id,type FROM (
       SELECT id,'comment' AS type,created_at,0 AS pinned
       FROM comments WHERE paper_id IS NOT NULL
       UNION ALL
       SELECT id,'proposal' AS type,created_at,(status='open') AS pinned
       FROM topic_proposals
     ) ORDER BY pinned DESC,created_at DESC,type,id DESC LIMIT 20 OFFSET ?`,
    offset,
  );
  const comments = new Map(
    paperCommentsByIds(
      db,
      user,
      rows.filter((r) => r.type === "comment").map((r) => r.id),
    ).map((c) => [c.id, c]),
  );
  const proposals = new Map(
    proposalsByIds(
      db,
      user,
      rows.filter((r) => r.type === "proposal").map((r) => r.id),
    ).map((p) => [p.id, p]),
  );
  const items = rows.map((row): CommunityActivity =>
    row.type === "comment"
      ? { type: "comment", comment: comments.get(row.id)! }
      : { type: "proposal", proposal: proposals.get(row.id)! },
  );
  return { items, total, offset };
}
