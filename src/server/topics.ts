import { randomUUID } from "node:crypto";
import type { Store } from "./db.ts";
import type { Topic, User, Proposal } from "../shared/types.ts";
import { check, text } from "./errors.ts";
export function paperTopics(db: Store, id: string): Topic[] {
  return db.all<Topic>(
    "SELECT t.id,t.name FROM topics t JOIN paper_topics p ON p.topic_id=t.id WHERE p.paper_id=? ORDER BY t.name",
    id,
  );
}
export function evaluateProposals(db: Store) {
  const users = db.get<{ n: number }>("SELECT count(*) n FROM users")!.n;
  for (const p of db.all<{
    id: string;
    paper_id: string;
    base_revision: number;
    after_topics: string;
  }>(
    "SELECT * FROM topic_proposals WHERE status='open' ORDER BY created_at,id",
  )) {
    const revision = db.get<{ topic_revision: number }>(
      "SELECT topic_revision FROM papers WHERE id=?",
      p.paper_id,
    )!.topic_revision;
    if (revision !== p.base_revision) {
      db.run("UPDATE topic_proposals SET status='superseded' WHERE id=?", p.id);
      continue;
    }
    const yes = db.get<{ n: number }>(
      "SELECT count(*) n FROM topic_votes WHERE proposal_id=? AND choice='yes'",
      p.id,
    )!.n;
    if (yes <= users / 2) continue;
    const topics = JSON.parse(p.after_topics) as Topic[];
    if (
      topics.some((topic) => {
        const existing = db.get<Topic>(
          "SELECT id,name FROM topics WHERE id=? OR name=? COLLATE NOCASE",
          topic.id,
          topic.name,
        );
        return (
          existing &&
          (existing.id !== topic.id ||
            existing.name.toLowerCase() !== topic.name.toLowerCase())
        );
      })
    ) {
      db.run("UPDATE topic_proposals SET status='superseded' WHERE id=?", p.id);
      continue;
    }
    for (const topic of topics)
      db.run(
        "INSERT INTO topics(id,name) VALUES (?,?) ON CONFLICT(id) DO NOTHING",
        topic.id,
        topic.name,
      );
    db.run("DELETE FROM paper_topics WHERE paper_id=?", p.paper_id);
    for (const topic of topics)
      db.run("INSERT INTO paper_topics VALUES (?,?)", p.paper_id, topic.id);
    db.run(
      "UPDATE papers SET topic_revision=topic_revision+1 WHERE id=?",
      p.paper_id,
    );
    db.run(
      "UPDATE topic_proposals SET status='adopted',adopted_users=?,adopted_yes=? WHERE id=?",
      users,
      yes,
      p.id,
    );
    db.run(
      "UPDATE topic_proposals SET status='superseded' WHERE paper_id=? AND status='open' AND base_revision<>(SELECT topic_revision FROM papers WHERE id=?)",
      p.paper_id,
      p.paper_id,
    );
  }
}
export function createProposal(
  db: Store,
  user: User,
  paperId: string,
  input: Record<string, unknown>,
) {
  return db.transaction(() => {
    const paper = db.get<{ topic_revision: number }>(
      "SELECT topic_revision FROM papers WHERE id=? AND available=1",
      paperId,
    );
    check(paper, 404, "Paper not found.");
    check(
      input.revision === paper.topic_revision,
      409,
      "Topics changed. Refresh the paper and propose again.",
      "revision_conflict",
    );
    check(
      Array.isArray(input.topics) && input.topics.length <= 12,
      400,
      "Choose at most 12 topics.",
    );
    const after = input.topics.map((value) => {
      const name = text(value, "Topic name", 80);
      const existing = db.get<Topic>(
        "SELECT id,name FROM topics WHERE id=? OR name=? COLLATE NOCASE",
        name,
        name,
      );
      if (existing) return existing;
      const id = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      check(id.length >= 2, 400, "New topics need an English name.");
      const collision = db.get<Topic>(
        "SELECT id,name FROM topics WHERE id=?",
        id,
      );
      check(
        !collision,
        400,
        "A similar topic already exists. Choose its existing name.",
      );
      return { id, name };
    });
    check(
      new Set(after.map((t) => t.id)).size === after.length,
      400,
      "Remove duplicate topics.",
    );
    const before = paperTopics(db, paperId);
    check(
      before
        .map((t) => t.id)
        .sort()
        .join() !==
        after
          .map((t) => t.id)
          .sort()
          .join(),
      400,
      "Propose a different set of topics.",
    );
    const open = db.get<{ n: number }>(
      "SELECT count(*) n FROM topic_proposals WHERE author_id=? AND status='open'",
      user.id,
    )!.n;
    check(open < 30, 429, "Finish existing proposals before creating more.");
    const id = randomUUID();
    db.run(
      "INSERT INTO topic_proposals(id,paper_id,author_id,base_revision,before_topics,after_topics,reason,created_at) VALUES (?,?,?,?,?,?,?,?)",
      id,
      paperId,
      user.id,
      paper.topic_revision,
      JSON.stringify(before),
      JSON.stringify(after),
      text(input.reason, "Reason", 2000),
      Date.now(),
    );
    return { id };
  });
}
export function vote(db: Store, user: User, id: string, choice: unknown) {
  check(
    choice === "yes" || choice === "no" || choice === null,
    400,
    "Choose approve, oppose, or withdraw.",
  );
  db.transaction(() => {
    const p = db.get<{ status: string }>(
      "SELECT status FROM topic_proposals WHERE id=?",
      id,
    );
    check(p, 404, "Proposal not found.");
    check(p.status === "open", 409, "This proposal has already ended.");
    if (choice === null)
      db.run(
        "DELETE FROM topic_votes WHERE proposal_id=? AND user_id=?",
        id,
        user.id,
      );
    else
      db.run(
        "INSERT INTO topic_votes VALUES (?,?,?) ON CONFLICT(proposal_id,user_id) DO UPDATE SET choice=excluded.choice",
        id,
        user.id,
        choice,
      );
    evaluateProposals(db);
  });
}
export function proposalPage(db: Store, user: User, params: URLSearchParams) {
  const status = params.get("status") || "open";
  check(
    status === "open" || status === "closed",
    400,
    "Invalid proposal status.",
  );
  const rawOffset = Number(params.get("offset"));
  const offset = Number.isFinite(rawOffset)
    ? Math.max(0, Math.floor(rawOffset))
    : 0;
  const total = db.get<{ n: number }>(
    `SELECT count(*) n FROM topic_proposals WHERE status ${status === "open" ? "=" : "<>"} 'open'`,
  )!.n;
  return {
    proposals: proposals(db, user, undefined, { status, offset }),
    total,
  };
}
export function proposals(
  db: Store,
  user: User,
  paperId?: string,
  page?: { status: "open" | "closed"; offset: number },
): Proposal[] {
  const ids = db
    .all<{ id: string }>(
      `SELECT p.id FROM topic_proposals p
     ${paperId ? "WHERE p.paper_id=?" : page ? `WHERE p.status ${page.status === "open" ? "=" : "<>"} 'open'` : ""}
     ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?`,
      ...(paperId ? [paperId] : []),
      page ? 20 : 200,
      page?.offset || 0,
    )
    .map((row) => row.id);
  return proposalsByIds(db, user, ids);
}
export function proposalsByIds(
  db: Store,
  user: User,
  ids: string[],
): Proposal[] {
  if (!ids.length) return [];
  const users = db.get<{ n: number }>("SELECT count(*) n FROM users")!.n;
  const items = db
    .all<Record<string, unknown>>(
      `SELECT p.*,u.username,u.display_name,pa.title FROM topic_proposals p
     JOIN users u ON u.id=p.author_id JOIN papers pa ON pa.id=p.paper_id
     WHERE p.id IN (${ids.map(() => "?").join(",")})`,
      ...ids,
    )
    .map((p) => ({
      id: p.id as string,
      paperId: p.paper_id as string,
      paperTitle: p.title as string,
      author: {
        id: p.author_id as string,
        username: p.username as string,
        displayName: p.display_name as string,
      },
      before: JSON.parse(p.before_topics as string),
      after: JSON.parse(p.after_topics as string),
      reason: p.reason as string,
      status: p.status as Proposal["status"],
      createdAt: p.created_at as number,
      yes: db.get<{ n: number }>(
        "SELECT count(*) n FROM topic_votes WHERE proposal_id=? AND choice='yes'",
        p.id as string,
      )!.n,
      no: db.get<{ n: number }>(
        "SELECT count(*) n FROM topic_votes WHERE proposal_id=? AND choice='no'",
        p.id as string,
      )!.n,
      users,
      required: Math.floor(users / 2) + 1,
      myVote:
        db.get<{ choice: "yes" | "no" }>(
          "SELECT choice FROM topic_votes WHERE proposal_id=? AND user_id=?",
          p.id as string,
          user.id,
        )?.choice ?? null,
      adoptedUsers: p.adopted_users as number | null,
      adoptedYes: p.adopted_yes as number | null,
    }));
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}
export function importTopics(db: Store, seed: unknown) {
  check(seed && typeof seed === "object", 400, "Invalid topic seed.");
  const s = seed as {
    version?: number;
    topics?: Topic[];
    papers?: { id: string; topics: string[] }[];
  };
  check(
    s.version === 1 && Array.isArray(s.topics) && Array.isArray(s.papers),
    400,
    "Invalid topic seed format.",
  );
  db.transaction(() => {
    check(
      !db.get("SELECT 1 FROM metadata WHERE key='topic_seed_imported'") &&
        !db.get("SELECT 1 FROM topics") &&
        !db.get("SELECT 1 FROM topic_proposals"),
      409,
      "Topics have already been initialized or proposed; refusing to overwrite them.",
    );
    for (const t of s.topics!) {
      check(
        typeof t.id === "string" && /^[a-z0-9-]{2,100}$/.test(t.id),
        400,
        "Invalid topic ID.",
      );
      db.run(
        "INSERT INTO topics VALUES (?,?)",
        t.id,
        text(t.name, "Topic", 80),
      );
    }
    for (const p of s.papers!) {
      check(
        db.get("SELECT 1 FROM papers WHERE id=?", p.id),
        400,
        `Unknown paper: ${p.id}`,
      );
      check(Array.isArray(p.topics), 400, "Invalid assignments.");
      for (const id of new Set(p.topics)) {
        check(
          db.get("SELECT 1 FROM topics WHERE id=?", id),
          400,
          "Unknown topic.",
        );
        db.run("INSERT INTO paper_topics VALUES (?,?)", p.id, id);
      }
    }
    db.run(
      "INSERT INTO metadata VALUES ('topic_seed_imported',?)",
      String(Date.now()),
    );
  });
}
