import { useEffect, useState } from "react";
import type { FolderDetail, FolderPaper, PaperOrder } from "../shared/types.ts";
import { sortPapers } from "../shared/types.ts";
import { api, useAction } from "./api.ts";
import {
  currentRoute,
  paperHref,
  routeParams,
  withReturn,
  useReturnFocus,
} from "./navigation.ts";
import { Empty, Notice, orderOptions } from "./ui.tsx";

export function FolderContents({
  folder,
  pending,
  onChanged,
  onDirtyChange,
  onRemove,
}: {
  folder: FolderDetail;
  pending: boolean;
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onRemove: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<{
    ids: string[];
    revision: number;
  } | null>(null);
  const [sort, setSort] = useState<PaperOrder | "">("");
  const [savedOrder, setSavedOrder] = useState<number | null>(null);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [before, setBefore] = useState("");
  const [drag, setDrag] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    body: string;
    revision: number;
  } | null>(null);
  const action = useAction();
  const busy = pending || action.busy;
  const dirty = !!draft || !!editing;
  useReturnFocus(!pending);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (savedOrder !== null && folder.revision >= savedOrder) {
      setDraft(null);
      setSort("");
      setSavedOrder(null);
    }
  }, [folder.revision, savedOrder]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    const leave = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>(
        "a[href^='#']",
      );
      if (
        link &&
        link.hash !== location.hash &&
        !confirm("Discard your unsaved folder changes?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", leave, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", leave, true);
    };
  }, [dirty]);
  useEffect(() => {
    setSelected(
      (old) =>
        new Set(
          [...old].filter((id) => folder.papers.some((p) => p.id === id)),
        ),
    );
  }, [folder.papers]);
  const byId = new Map(folder.papers.map((p) => [p.id, p]));
  const shown = draft
    ? draft.ids.map((id) => byId.get(id)).filter((p): p is FolderPaper => !!p)
    : !folder.ordered && sort
      ? sortPapers(folder.papers, sort).map((p) => byId.get(p.id)!)
      : folder.papers;
  function changeOrder(papers: FolderPaper[]) {
    setDraft((old) => ({
      ids: papers.map((p) => p.id),
      revision: old?.revision ?? folder.revision,
    }));
  }
  function step(id: string, direction: number) {
    const next = [...shown],
      at = next.findIndex((p) => p.id === id),
      to = at + direction;
    if (at < 0 || to < 0 || to >= next.length) return;
    [next[at], next[to]] = [next[to], next[at]];
    setSort("");
    changeOrder(next);
  }
  function move(chosen: Set<string>, target: string | null) {
    const moving = shown.filter((p) => chosen.has(p.id)),
      rest = shown.filter((p) => !chosen.has(p.id));
    const at = target ? rest.findIndex((p) => p.id === target) : rest.length;
    if (at < 0) return;
    setSort("");
    changeOrder([...rest.slice(0, at), ...moving, ...rest.slice(at)]);
  }
  function changeSort(value: PaperOrder | "") {
    setSort(value);
    if (!folder.ordered || !value) return;
    const subset = selectedOnly
      ? shown.filter((p) => selected.has(p.id))
      : shown;
    const sorted = sortPapers(subset, value, Date.now()).map((p) =>
      byId.get(p.id)!,
    );
    let i = 0;
    changeOrder(
      shown.map((p) => (!selectedOnly || selected.has(p.id) ? sorted[i++] : p)),
    );
  }
  function cancel() {
    setDraft(null);
    setEditing(null);
    setSort("");
    action.clear();
  }
  if (!shown.length)
    return (
      <Empty title="Your folder is ready">
        Add papers from the library or another folder.
      </Empty>
    );
  return (
    <section
      className="folder-contents"
      aria-label="Folder papers"
      aria-busy={busy}
    >
      <div className="folder-list-controls">
        {(!folder.ordered || folder.canEdit) && (
          <label className="field compact">
            <span>{folder.ordered ? "Reading order" : "Display order"}</span>
            <select
              aria-label={
                folder.ordered ? "Reading order" : "Display order (only you)"
              }
              value={sort}
              disabled={busy || !!editing}
              onChange={(e) => changeSort(e.target.value as PaperOrder | "")}
            >
              <option value="" disabled={folder.ordered}>
                {draft ? "Custom order" : "Folder order"}
              </option>
              {orderOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {folder.canEdit && !draft && !editing && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              setSelected(
                selected.size === shown.length
                  ? new Set()
                  : new Set(shown.map((p) => p.id)),
              )
            }
          >
            {selected.size === shown.length ? "Clear selection" : "Select all"}
          </button>
        )}
        {draft && (
          <div className="order-save" role="status">
            <span>Order preview</span>
            <button disabled={busy} onClick={cancel}>
              Cancel order
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void action.run(async () => {
                  const saved = await api<FolderDetail>(
                    `/folders/${folder.id}/order`,
                    "PUT",
                    {
                      revision: draft.revision,
                      paperIds: draft.ids,
                    },
                  );
                  setSavedOrder(saved.revision);
                  onChanged();
                })
              }
            >
              Save reading order
            </button>
          </div>
        )}
      </div>
      {!!selected.size && folder.canEdit && (
        <div className="selection-bar folder-selection">
          <span>{selected.size} selected</span>
          {folder.ordered && (
            <>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={selectedOnly}
                  disabled={busy || !!editing}
                  onChange={(e) => setSelectedOnly(e.target.checked)}
                />{" "}
                Sort selected only
              </label>
              <button
                disabled={busy || !!editing}
                onClick={() =>
                  move(
                    selected,
                    shown.find((p) => !selected.has(p.id))?.id ?? null,
                  )
                }
              >
                Move to top
              </button>
              <button
                disabled={busy || !!editing}
                onClick={() => move(selected, null)}
              >
                Move to bottom
              </button>
              <select
                aria-label="Move before paper"
                value={before}
                disabled={busy || !!editing}
                onChange={(e) => setBefore(e.target.value)}
              >
                <option value="">Move before…</option>
                {shown
                  .filter((p) => !selected.has(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </select>
              <button
                disabled={busy || !!editing || !before}
                onClick={() => move(selected, before)}
              >
                Move before
              </button>
            </>
          )}
          <button
            disabled={busy || !!editing}
            onClick={() => {
              setSelected(new Set());
              setSelectedOnly(false);
            }}
          >
            Clear selection
          </button>
          <button
            className="text-button danger"
            disabled={busy || dirty}
            onClick={() => onRemove([...selected])}
          >
            Remove selected
          </button>
        </div>
      )}
      <Notice>{action.error}</Notice>
      {action.error && action.errorStatus !== 0 && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            cancel();
            onChanged();
          }}
        >
          Discard changes and reload
        </button>
      )}
      <ol
        className={`folder-papers ${folder.ordered ? "ordered" : "unordered"}`}
      >
        {shown.map((paper, index) => {
          const completed = folder.progress?.completed.includes(paper.id);
          const origin = routeParams();
          origin.set("focus", paper.id);
          const readHref = `#${withReturn(`read/${folder.id}?paper=${paper.id}`, `${currentRoute().split("?")[0]}?${origin}`)}`;
          return (
            <li
              className="folder-paper"
              id={`paper-${paper.id}`}
              key={paper.id}
              onDragOver={(event) => {
                if (drag && !busy && !editing) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (drag && drag !== paper.id && !busy && !editing)
                  move(
                    selected.has(drag) ? selected : new Set([drag]),
                    paper.id,
                  );
                setDrag(null);
              }}
            >
              <div className="folder-item-leading">
                {folder.canEdit && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${paper.title}`}
                    checked={selected.has(paper.id)}
                    disabled={busy || !!editing}
                    onChange={() =>
                      setSelected((old) => {
                        const next = new Set(old);
                        next.has(paper.id)
                          ? next.delete(paper.id)
                          : next.add(paper.id);
                        return next;
                      })
                    }
                  />
                )}
                {folder.ordered && (
                  <span
                    className={`item-position ${completed ? "completed" : ""}`}
                    title={completed ? "Completed" : undefined}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                )}
              </div>
              <div className="folder-item-content">
                <div className="folder-item-meta">
                  {paper.conference} {paper.year}
                  {!paper.available && " · Unavailable"}
                  {completed && (
                    <span className="completion-mark" aria-label="Completed">
                      ✓ Read
                    </span>
                  )}
                </div>
                <h2>
                  <a href={paperHref(paper.id)}>{paper.title}</a>
                </h2>
                {paper.note && editing?.id !== paper.id && (
                  <p className="folder-note">{paper.note}</p>
                )}
                {editing?.id === paper.id && (
                  <form
                    className="note-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void action.run(async () => {
                        await api(
                          `/folders/${folder.id}/papers/${paper.id}/note`,
                          "PUT",
                          { note: editing.body, revision: editing.revision },
                        );
                        setEditing(null);
                        onChanged();
                      });
                    }}
                  >
                    <label className="field">
                      <span>Folder note</span>
                      <textarea
                        autoFocus
                        maxLength={5000}
                        value={editing.body}
                        disabled={busy}
                        onChange={(e) =>
                          setEditing({ ...editing, body: e.target.value })
                        }
                      />
                    </label>
                    <span className="hint">
                      Visible to everyone with access to this folder.
                    </span>
                    <div className="actions">
                      <button className="primary" disabled={busy} type="submit">
                        Save note
                      </button>
                      <button
                        disabled={busy}
                        type="button"
                        onClick={() => {
                          setEditing(null);
                          action.clear();
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
                <div className="folder-item-actions">
                  {folder.ordered && <a href={readHref}>Read</a>}
                  <a href={paperHref(paper.id, true)}>Discuss</a>
                  {folder.canEdit && editing?.id !== paper.id && (
                    <button
                      className="text-button"
                      disabled={busy || dirty}
                      onClick={() => {
                        action.clear();
                        setEditing({
                          id: paper.id,
                          body: paper.note,
                          revision: folder.revision,
                        });
                      }}
                    >
                      {paper.note ? "Edit note" : "Add note"}
                    </button>
                  )}
                  <details className="folder-abstract">
                    <summary>Abstract</summary>
                    <div>
                      <p className="authors">{paper.authors.join(", ")}</p>
                      <p className="abstract">{paper.abstract}</p>
                      <a
                        href={paper.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Official source ↗
                      </a>
                    </div>
                  </details>
                </div>
              </div>
              {folder.ordered && folder.canEdit && (
                <div className="item-order-controls">
                  <button
                    aria-label={`Move ${paper.title} up`}
                    title="Move up"
                    disabled={busy || !!editing || index === 0}
                    onClick={() => step(paper.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Move ${paper.title} down`}
                    title="Move down"
                    disabled={busy || !!editing || index === shown.length - 1}
                    onClick={() => step(paper.id, 1)}
                  >
                    ↓
                  </button>
                  <span
                    className="drag-handle"
                    aria-hidden
                    draggable={!busy && !editing}
                    title="Drag to reorder"
                    onDragStart={(e) => {
                      setDrag(paper.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", paper.id);
                    }}
                    onDragEnd={() => setDrag(null)}
                  >
                    ⠿
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
