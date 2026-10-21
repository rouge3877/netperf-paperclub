import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCorpus } from "../src/server/corpus.ts";
const papers = loadCorpus("corpus");
describe("canonical English corpus", () => {
  it("has unique IDs, seven-field records and correct conference/year paths", () => {
    expect(papers.length).toBeGreaterThan(0);
    expect(new Set(papers.map((p) => p.id)).size).toBe(papers.length);
    for (const p of papers) {
      expect(Object.keys(p).sort()).toEqual([
        "abstract",
        "authors",
        "conference",
        "id",
        "title",
        "url",
        "year",
      ]);
      expect(p.abstract.length).toBeGreaterThan(20);
    }
  });
  it("rejects extra fields, missing authors, directory mismatches and unsafe source URLs", () => {
    const root = mkdtempSync(join(tmpdir(), "paperclub-corpus-"));
    const paper = papers[0];
    const dir = join(root, paper.conference.toLowerCase(), String(paper.year));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${paper.id}.json`);
    try {
      writeFileSync(file, JSON.stringify(paper));
      expect(loadCorpus(root)).toEqual([paper]);
      for (const change of [
        { topics: ["Should live in the database"] },
        { authors: [] },
        { year: paper.year + 1 },
        { url: "javascript:alert(1)" },
      ]) {
        writeFileSync(file, JSON.stringify({ ...paper, ...change }));
        expect(() => loadCorpus(root)).toThrow(/Invalid/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
