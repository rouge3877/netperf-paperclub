import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Paper } from "../shared/types.ts";
import type { Store } from "./db.ts";
const fields = [
  "abstract",
  "authors",
  "conference",
  "id",
  "title",
  "url",
  "year",
];
export function loadCorpus(root: string): Paper[] {
  const papers: Paper[] = [],
    seen = new Set<string>();
  for (const conference of readdirSync(root, { withFileTypes: true }).filter(
    (x) => x.isDirectory(),
  )) {
    for (const year of readdirSync(join(root, conference.name), {
      withFileTypes: true,
    }).filter((x) => x.isDirectory())) {
      for (const file of readdirSync(
        join(root, conference.name, year.name),
      ).filter((n) => n.endsWith(".json"))) {
        const path = join(root, conference.name, year.name, file);
        const p = JSON.parse(readFileSync(path, "utf8")) as Paper;
        if (
          Object.keys(p).sort().join() !== fields.join() ||
          !/^p-[a-zA-Z0-9-]+$/.test(p.id) ||
          seen.has(p.id) ||
          file !== `${p.id}.json` ||
          p.conference?.toLowerCase() !== conference.name ||
          String(p.year) !== year.name ||
          !Number.isInteger(p.year) ||
          p.year < 1900 ||
          p.year > 2200 ||
          !Array.isArray(p.authors) ||
          !p.authors.length ||
          p.authors.some((a) => typeof a !== "string" || !a.trim()) ||
          typeof p.title !== "string" ||
          !p.title.trim() ||
          typeof p.abstract !== "string" ||
          !p.abstract.trim()
        )
          throw new Error(`Invalid corpus record: ${path}`);
        const url = new URL(p.url);
        if (url.protocol !== "https:" || url.username || url.password)
          throw new Error(`Invalid paper URL: ${path}`);
        seen.add(p.id);
        papers.push(p);
      }
    }
  }
  if (!papers.length) throw new Error("The corpus is empty.");
  return papers.sort((a, b) => a.id.localeCompare(b.id));
}
export function syncCorpus(store: Store, papers: Paper[]) {
  store.transaction(() => {
    store.run("UPDATE papers SET available=0");
    for (const p of papers)
      store.run(
        `INSERT INTO papers(id,title,abstract,authors,conference,year,url,available) VALUES (?,?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, abstract=excluded.abstract, authors=excluded.authors, conference=excluded.conference, year=excluded.year, url=excluded.url, available=1`,
        p.id,
        p.title,
        p.abstract,
        JSON.stringify(p.authors),
        p.conference,
        p.year,
        p.url,
      );
  });
}
