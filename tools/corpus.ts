import { loadCorpus } from "../src/server/corpus.ts";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const papers = loadCorpus(resolve(process.env.CORPUS_PATH || "corpus"));
const [command = "check", reference] = process.argv.slice(2);
if (command === "compare") {
  if (!reference)
    throw new Error(
      "Usage: npm run corpus:compare -- /path/to/english-preservation.json",
    );
  const snapshot = JSON.parse(readFileSync(reference, "utf8")) as {
    count: number;
    records: Record<string, string>;
  };
  if (Object.keys(snapshot.records).length !== snapshot.count)
    throw new Error("Invalid preservation reference.");
  const byId = new Map(papers.map((paper) => [paper.id, paper]));
  for (const [id, expected] of Object.entries(snapshot.records)) {
    const paper = byId.get(id);
    if (!paper) throw new Error(`Missing original paper: ${id}`);
    const canonical = JSON.stringify(
      Object.fromEntries(
        Object.entries(paper).sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
    if (createHash("sha256").update(canonical).digest("hex") !== expected)
      throw new Error(`Paper differs from the migration reference: ${id}`);
  }
  console.log(
    `Preserved all ${snapshot.count} original English records exactly.`,
  );
} else if (command !== "check") {
  throw new Error("Commands: check, compare REFERENCE_FILE");
}
console.log(
  `Validated ${papers.length} English papers with exactly seven fields.`,
);
