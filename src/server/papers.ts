import type { Store } from "./db.ts";
import { paperTopics } from "./topics.ts";
import type { User, PaperView } from "../shared/types.ts";
import { sortPapers } from "../shared/types.ts";
import { check } from "./errors.ts";
interface PaperRow {
  id: string;
  title: string;
  abstract: string;
  authors: string;
  conference: string;
  year: number;
  url: string;
  available: number;
  topic_revision: number;
  rating: number | null;
  ratingCount: number;
  myRating: number | null;
}
export function listPapers(db: Store, user: User): PaperView[] {
  const topics = db.all<{ paper_id: string; id: string; name: string }>(
    "SELECT pt.paper_id,t.id,t.name FROM paper_topics pt JOIN topics t ON t.id=pt.topic_id ORDER BY t.name",
  );
  const byId = new Map<string, { id: string; name: string }[]>();
  for (const t of topics)
    byId.set(t.paper_id, [
      ...(byId.get(t.paper_id) || []),
      { id: t.id, name: t.name },
    ]);
  return db
    .all<PaperRow>(
      `SELECT p.*,r.rating,coalesce(r.n,0) ratingCount,m.score myRating FROM papers p LEFT JOIN (SELECT paper_id,avg(score) rating,count(*) n FROM ratings GROUP BY paper_id) r ON r.paper_id=p.id LEFT JOIN ratings m ON m.paper_id=p.id AND m.user_id=?`,
      user.id,
    )
    .map((p) => ({
      id: p.id,
      title: p.title,
      abstract: p.abstract,
      authors: JSON.parse(p.authors),
      conference: p.conference,
      year: p.year,
      url: p.url,
      available: !!p.available,
      topicRevision: p.topic_revision,
      topics: byId.get(p.id) || [],
      rating: p.rating,
      ratingCount: p.ratingCount,
      myRating: p.myRating,
    }));
}
export function getPaper(db: Store, user: User, id: string) {
  const p = listPapers(db, user).find((p) => p.id === id);
  check(p, 404, "Paper not found.");
  return p;
}
export function searchPapers(db: Store, user: User, params: URLSearchParams) {
  const all = listPapers(db, user);
  const query = (params.get("q") || "").trim().toLowerCase();
  const conferences = params.getAll("conference").filter(Boolean),
    years = params.getAll("year").filter(Boolean).map(Number),
    topics = params.getAll("topic").filter(Boolean);
  let papers = all.filter(
    (p) =>
      p.available &&
      (!query ||
        `${p.title}\n${p.authors.join(" ")}\n${p.abstract}`
          .toLowerCase()
          .includes(query)) &&
      (!conferences.length || conferences.includes(p.conference)) &&
      (!years.length || years.includes(p.year)) &&
      (!topics.length || p.topics.some((t) => topics.includes(t.id))),
  );
  const order = params.get("sort") || "newest";
  check(
    ["oldest", "newest", "title", "conference", "rating", "random"].includes(
      order,
    ),
    400,
    "Invalid sort.",
  );
  papers = sortPapers(
    papers,
    order as Parameters<typeof sortPapers>[1],
    Number(params.get("seed") || 1),
  );
  const offset = Math.max(0, Number(params.get("offset")) || 0),
    limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 40));
  return {
    papers: papers.slice(offset, offset + limit),
    ids: papers.map((p) => p.id),
    total: papers.length,
    topics: db.all("SELECT id,name FROM topics ORDER BY name"),
    conferences: [
      ...new Set(all.filter((p) => p.available).map((p) => p.conference)),
    ].sort(),
    years: [...new Set(all.filter((p) => p.available).map((p) => p.year))].sort(
      (a, b) => b - a,
    ),
  };
}
export function ratePaper(db: Store, user: User, id: string, value: unknown) {
  check(
    db.get("SELECT 1 FROM papers WHERE id=? AND available=1", id),
    404,
    "Paper not found.",
  );
  check(
    value === null ||
      (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5),
    400,
    "Choose a score from 1 to 5.",
  );
  if (value === null)
    db.run("DELETE FROM ratings WHERE user_id=? AND paper_id=?", user.id, id);
  else
    db.run(
      "INSERT INTO ratings VALUES (?,?,?) ON CONFLICT(user_id,paper_id) DO UPDATE SET score=excluded.score",
      user.id,
      id,
      value as number,
    );
  return { topics: paperTopics(db, id) };
}
