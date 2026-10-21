import { useEffect, useState } from "react";
import type { PaperView, PaperOrder, Topic } from "../shared/types.ts";
import { api, useAction, useResource, useDebouncedValue } from "./api.ts";
import {
  PaperCard,
  Loading,
  Notice,
  OrderSelect,
  Empty,
  Back,
  Modal,
  orderOptions,
} from "./ui.tsx";
import { Discussion, ProposalList, ProposeDialog } from "./Discussion.tsx";
import { returnRoute, returnLabel, useReturnFocus } from "./navigation.ts";
interface SearchResult {
  papers: PaperView[];
  ids: string[];
  total: number;
  topics: Topic[];
  conferences: string[];
  years: number[];
}
function lastLibrarySearch() {
  try {
    return sessionStorage.getItem("paperclub-library") || "";
  } catch {
    return "";
  }
}
function FilterPanel({
  data,
  params,
  toggle,
  reset,
}: {
  data: SearchResult | null;
  params: URLSearchParams;
  toggle: (key: string, value: string) => void;
  reset: () => void;
}) {
  return (
    <>
      <div className="filter-heading">
        <h2>Filters</h2>
        <button className="text-button" onClick={reset}>
          Reset filters
        </button>
      </div>
      <fieldset className="facet">
        <legend>Conference</legend>
        <div className="facet-chips">
          {data?.conferences.map((conference) => (
            <button
              key={conference}
              aria-pressed={params.getAll("conference").includes(conference)}
              onClick={() => toggle("conference", conference)}
            >
              {conference}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="facet">
        <legend>Year</legend>
        <div className="facet-chips">
          {data?.years.map((year) => (
            <button
              key={year}
              aria-pressed={params.getAll("year").includes(String(year))}
              onClick={() => toggle("year", String(year))}
            >
              {year}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="facet">
        <legend>Topics</legend>
        <div className="facet-topics">
          {data?.topics.map((topic) => (
            <label key={topic.id}>
              <input
                type="checkbox"
                checked={params.getAll("topic").includes(topic.id)}
                onChange={() => toggle("topic", topic.id)}
              />
              <span>{topic.name}</span>
            </label>
          ))}
          {data?.topics.length === 0 && (
            <p className="hint">
              Topics appear after the community adopts them.
            </p>
          )}
        </div>
      </fieldset>
    </>
  );
}
export function PapersPage({ onAdd }: { onAdd: (ids: string[]) => void }) {
  const [params, setParams] = useState(() => {
    const initial = new URLSearchParams(
      location.hash.split("?")[1] || lastLibrarySearch(),
    );
    // Older bookmarks used single-paper offsets.
    if (initial.has("view")) {
      initial.delete("view");
      initial.delete("offset");
    }
    return initial;
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const limit = 30;
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const order = params.get("sort");
  const query = useDebouncedValue(params.get("q") || "");
  const sort = orderOptions.some(([value]) => value === order)
    ? (order as PaperOrder)
    : "newest";
  const request = new URLSearchParams(params);
  request.set("q", query);
  request.set("sort", sort);
  request.set("limit", String(limit));
  request.set("offset", String(offset));
  const result = useResource<SearchResult>(`/papers?${request}`, 0, true);
  const pending = result.pending || query !== (params.get("q") || "");
  useReturnFocus(!!result.data && !pending);
  const catalog = useResource<SearchResult>("/papers?limit=1");
  useEffect(() => {
    const search = params.toString();
    history.replaceState(null, "", `#papers${search ? `?${search}` : ""}`);
    try {
      sessionStorage.setItem("paperclub-library", search);
    } catch {
      /* Optional browsing preference. */
    }
  }, [params]);
  const change = (key: string, value: string) =>
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.delete("focus");
      value ? next.set(key, value) : next.delete(key);
      if (key !== "offset") next.delete("offset");
      return next;
    });
  const toggleFilter = (key: string, value: string) =>
    setParams((old) => {
      const next = new URLSearchParams(old),
        values = old.getAll(key);
      next.delete("focus");
      next.delete(key);
      (values.includes(value)
        ? values.filter((v) => v !== value)
        : [...values, value]
      ).forEach((v) => next.append(key, v));
      next.delete("offset");
      return next;
    });
  const reset = () =>
    setParams((old) => {
      const next = new URLSearchParams(old);
      ["q", "conference", "year", "topic", "offset", "focus"].forEach((key) =>
        next.delete(key),
      );
      return next;
    });
  const togglePaper = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const facets = (
    <FilterPanel
      data={catalog.data}
      params={params}
      toggle={toggleFilter}
      reset={reset}
    />
  );
  const activeFilters = ["conference", "year", "topic"].reduce(
    (n, key) => n + params.getAll(key).length,
    0,
  );
  const turnPage = (next: number) => {
    change("offset", String(next));
    window.scrollTo(0, 0);
  };
  return (
    <div className="library-layout">
      <aside className="library-sidebar" aria-label="Paper filters">
        {facets}
      </aside>
      <div className="library-reading" aria-busy={pending}>
        <div className="library-heading">
          <h1>All Paper</h1>
        </div>
        <label className="field library-search">
          <span className="sr-only">Search the library</span>
          <input
            type="search"
            value={params.get("q") || ""}
            onChange={(e) => change("q", e.target.value)}
            placeholder="Search titles, authors, and abstracts…"
          />
        </label>
        <div className="library-controls">
          <div className="library-count" role="status">
            {result.data
              ? `${result.data.total.toLocaleString()} ${result.data.total === 1 ? "paper" : "papers"}`
              : "Loading…"}
            <span
              className={`update-indicator ${pending ? "visible" : ""}`}
              aria-hidden="true"
            />
          </div>
          <button
            className="mobile-filter-button"
            onClick={() => setFiltersOpen(true)}
          >
            Filters{activeFilters ? ` (${activeFilters})` : ""}
          </button>
          <OrderSelect
            value={sort}
            onChange={(value) => change("sort", value)}
          />
        </div>
        <div className="selection-bar">
          <span>{selected.size ? `${selected.size} selected` : ""}</span>
          <button
            disabled={pending || !result.data?.ids.length}
            onClick={() =>
              setSelected((old) => new Set([...old, ...result.data!.ids]))
            }
          >
            Select all results
          </button>
          {selected.size > 0 && (
            <>
              <button onClick={() => setSelected(new Set())}>Clear</button>
              <button className="primary" onClick={() => onAdd([...selected])}>
                Add selection to folder
              </button>
            </>
          )}
        </div>
        <Notice>{result.error || catalog.error}</Notice>
        {result.loading ? (
          <Loading />
        ) : result.data?.papers.length ? (
          <div className="paper-list">
            {result.data.papers.map((paper) => (
              <PaperCard
                key={paper.id}
                paper={paper}
                expanded
                disabled={pending}
                selected={selected.has(paper.id)}
                onSelect={() => togglePaper(paper.id)}
                onAdd={() => onAdd([paper.id])}
              />
            ))}
          </div>
        ) : (
          <Empty title="No matching papers">
            Try a broader query or reset your filters.
          </Empty>
        )}
        <div className="pagination">
          <button
            disabled={offset === 0 || pending}
            onClick={() => turnPage(Math.max(0, offset - limit))}
          >
            Previous page
          </button>
          <span>Page {Math.floor(offset / limit) + 1}</span>
          <button
            disabled={pending || offset + limit >= (result.data?.total || 0)}
            onClick={() => turnPage(offset + limit)}
          >
            Next page
          </button>
        </div>
      </div>
      {filtersOpen && (
        <Modal title="Paper filters" onClose={() => setFiltersOpen(false)}>
          {facets}
          <button
            className="primary full"
            onClick={() => setFiltersOpen(false)}
          >
            Show results
          </button>
        </Modal>
      )}
    </div>
  );
}
export function PaperPage({
  id,
  onAdd,
  showDiscussion = false,
}: {
  id: string;
  showDiscussion?: boolean;
  onAdd: (ids: string[]) => void;
}) {
  const [version, setVersion] = useState(0),
    [proposing, setProposing] = useState(false);
  const result = useResource<PaperView>(`/papers/${id}`, version);
  const action = useAction();
  useEffect(() => {
    if (showDiscussion && result.data)
      document.getElementById("discussion")?.scrollIntoView();
  }, [showDiscussion, result.data?.id]);
  if (result.loading) return <Loading />;
  if (!result.data) return <Notice>{result.error}</Notice>;
  const paper = result.data;
  const back = returnRoute(`papers?${lastLibrarySearch()}`);
  return (
    <div className="paper-detail">
      <Back to={back} label={returnLabel(back)} />
      <PaperCard paper={paper} full onAdd={() => onAdd([paper.id])} />
      <Notice>{action.error}</Notice>
      <section className="paper-interactions">
        <label className="field compact">
          <span>Your rating</span>
          <select
            aria-label="Your rating"
            value={paper.myRating ?? ""}
            disabled={action.busy}
            onChange={(e) => {
              const value = e.target.value;
              void action.run(async () => {
                await api(`/papers/${id}/rating`, "PUT", {
                  score: value ? Number(value) : null,
                });
                setVersion((v) => v + 1);
              });
            }}
          >
            <option value="">Not rated</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option value={n} key={n}>
                {n} {n === 1 ? "star" : "stars"}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setProposing(true)}>Propose topic change</button>
      </section>
      <Discussion paperId={id} />
      <section className="topic-history">
        <h2>Topic proposals & history</h2>
        <ProposalList
          paperId={id}
          version={version}
          onChanged={() => setVersion((v) => v + 1)}
        />
      </section>
      {proposing && (
        <ProposeDialog
          paper={paper}
          onClose={() => setProposing(false)}
          onSaved={() => {
            setProposing(false);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
