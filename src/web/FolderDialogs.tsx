import { useState } from "react";
import type {
  Folder,
  FolderDetail,
  PaperView,
  PaperOrder,
  User,
} from "../shared/types.ts";
import { sortPapers } from "../shared/types.ts";
import { api, useAction, useResource, useDebouncedValue } from "./api.ts";
import { Modal, Notice, Loading, OrderSelect } from "./ui.tsx";
export function FolderForm({
  folder,
  onClose,
  onSaved,
}: {
  folder?: FolderDetail;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(folder?.name || ""),
    [description, setDescription] = useState(folder?.description || ""),
    [ordered, setOrdered] = useState(folder?.ordered ?? true),
    [visibility, setVisibility] = useState(folder?.visibility || "private");
  const action = useAction();
  return (
    <Modal
      title={folder ? "Folder settings" : "Create a Paper Folder"}
      onClose={onClose}
    >
      <Notice>{action.error}</Notice>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const result = await api<{ id: string }>(
              folder ? `/folders/${folder.id}` : "/folders",
              folder ? "PATCH" : "POST",
              {
                name,
                description,
                ...(!folder ? { ordered } : { revision: folder.revision }),
                ...(!folder || folder.isOwner ? { visibility } : {}),
              },
            );
            onSaved(result.id);
          });
        }}
      >
        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Congestion control foundations"
          />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            maxLength={3000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What should readers know about this folder?"
          />
        </label>
        {!folder && (
          <label className="check-field">
            <input
              type="checkbox"
              checked={ordered}
              onChange={(e) => setOrdered(e.target.checked)}
            />
            <span>
              <strong>Ordered reading folder</strong>
              <small>
                Maintain a shared sequence and independent progress for every
                reader. The mode is fixed after creation.
              </small>
            </span>
          </label>
        )}
        {(!folder || folder.isOwner) && (
          <label className="field">
            <span>Visibility</span>
            <select
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as "private" | "public")
              }
            >
              <option value="private">Private — owner and collaborators</option>
              <option value="public">Public — all signed-in members</option>
            </select>
          </label>
        )}
        <button disabled={action.busy} className="primary">
          {folder ? "Save settings" : "Create folder"}
        </button>
      </form>
    </Modal>
  );
}
export function AddToFolder({
  paperIds,
  onClose,
}: {
  paperIds: string[];
  onClose: () => void;
}) {
  const [version, setVersion] = useState(0),
    [creating, setCreating] = useState(false),
    [done, setDone] = useState("");
  const folders = useResource<{ folders: Folder[] }>(
    "/folders?scope=mine",
    version,
  );
  const action = useAction();
  async function add(id: string, revision: number) {
    await api(`/folders/${id}/papers`, "POST", { paperIds, revision });
    setDone("Papers added. Existing members were skipped.");
    setVersion((v) => v + 1);
  }
  return (
    <>
      {!creating && (
        <Modal
          title={`Add ${paperIds.length === 1 ? "paper" : `${paperIds.length} papers`} to a folder`}
          onClose={onClose}
        >
          <Notice>{folders.error || action.error}</Notice>
          {done && (
            <p className="success" role="status">
              {done}
            </p>
          )}
          {folders.loading ? (
            <Loading />
          ) : (
            <div className="folder-choices">
              {folders.data?.folders.map((f) => (
                <button
                  key={f.id}
                  disabled={action.busy}
                  onClick={() => void action.run(() => add(f.id, f.revision))}
                >
                  <strong>{f.name}</strong>
                  <span>
                    {f.ordered ? "Ordered" : "Unordered"} · {f.visibility} ·{" "}
                    {f.paperCount} papers
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="modal-actions">
            <button onClick={() => setCreating(true)}>
              Create a new folder
            </button>
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </Modal>
      )}
      {creating && (
        <FolderForm
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            void action.run(() => add(id, 1));
          }}
        />
      )}
    </>
  );
}
interface SearchResult {
  papers: PaperView[];
  ids: string[];
  total: number;
  topics: { id: string; name: string }[];
  conferences: string[];
  years: number[];
}
export function AddPapersDialog({
  folder,
  onClose,
  onSaved,
}: {
  folder: FolderDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState("browse"),
    [query, setQuery] = useState(""),
    [conference, setConference] = useState(""),
    [year, setYear] = useState(""),
    [topic, setTopic] = useState(""),
    [order, setOrder] = useState<PaperOrder>("oldest"),
    [offset, setOffset] = useState(0),
    [source, setSource] = useState(""),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [preview, setPreview] = useState<PaperView[] | null>(null),
    [after, setAfter] = useState("append");
  const action = useAction();
  const debouncedQuery = useDebouncedValue(query);
  const params = new URLSearchParams({
    q: debouncedQuery,
    conference,
    year,
    topic,
    sort: order,
    offset: String(offset),
    limit: "40",
  });
  const found = useResource<SearchResult>(
    mode === "browse" ? `/papers?${params}` : null,
    0,
    true,
  );
  const own = useResource<{ folders: Folder[] }>("/folders?scope=mine"),
    pub = useResource<{ folders: Folder[] }>("/folders?scope=public");
  const sources = [
    ...new Map(
      [...(own.data?.folders || []), ...(pub.data?.folders || [])]
        .filter((f) => f.id !== folder.id)
        .map((f) => [f.id, f]),
    ).values(),
  ];
  const sourceData = useResource<FolderDetail>(
    mode === "folder" && source ? `/folders/${source}` : null,
  );
  const pending =
    mode === "browse"
      ? found.pending || query !== params.get("q")
      : sourceData.pending;
  const existing = new Set(folder.papers.map((p) => p.id)),
    visible =
      mode === "browse"
        ? found.data?.papers || []
        : sourceData.data?.papers || [];
  const candidates = (
    mode === "browse" ? found.data?.ids || [] : visible.map((p) => p.id)
  ).filter((id) => !existing.has(id));
  const toggle = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const changeMode = (v: string) => {
    setMode(v);
    setSelected(new Set());
    setPreview(null);
  };
  return (
    <Modal
      title={preview ? "Review additions" : "Add papers"}
      wide
      onClose={onClose}
    >
      <Notice>{action.error || found.error || sourceData.error}</Notice>
      {preview ? (
        <>
          <p>
            {preview.length} new papers will be added. Existing papers are
            excluded.
          </p>
          <p className="hint">
            The preview follows your selection or source folder order. You can
            apply a sort before adding.
          </p>
          <div className="organize-controls">
            <OrderSelect
              value={order}
              onChange={setOrder}
              label="Sort additions"
            />
            <button
              onClick={() => setPreview(sortPapers(preview, order, Date.now()))}
            >
              Preview sort
            </button>
          </div>
          <ol className="preview-list">
            {preview.map((p) => (
              <li key={p.id}>
                <span>{p.title}</span>
                <small>
                  {p.conference} {p.year}
                </small>
                <button
                  className="text-button"
                  onClick={() =>
                    setPreview(preview.filter((x) => x.id !== p.id))
                  }
                  aria-label={`Exclude ${p.title}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
          {folder.ordered && (
            <label className="field">
              <span>Insert papers</span>
              <select value={after} onChange={(e) => setAfter(e.target.value)}>
                <option value="append">At the end</option>
                <option value="start">At the beginning</option>
                {folder.papers.map((p) => (
                  <option key={p.id} value={p.id}>
                    After: {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="modal-actions">
            <button onClick={() => setPreview(null)}>Back to selection</button>
            <button
              className="primary"
              disabled={action.busy || !preview.length}
              onClick={() =>
                void action.run(async () => {
                  await api(`/folders/${folder.id}/papers`, "POST", {
                    revision: folder.revision,
                    paperIds: preview.map((p) => p.id),
                    ...(mode === "folder" ? { sourceFolder: source } : {}),
                    ...(after === "append"
                      ? {}
                      : { afterId: after === "start" ? null : after }),
                  });
                  onSaved();
                })
              }
            >
              Add {preview.length} papers
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="tabs">
            <button
              className={mode === "browse" ? "active" : ""}
              onClick={() => changeMode("browse")}
            >
              Browse papers
            </button>
            <button
              className={mode === "folder" ? "active" : ""}
              onClick={() => changeMode("folder")}
            >
              Copy from a folder
            </button>
          </div>
          {mode === "browse" ? (
            <div className="filters picker-filters">
              <label className="field">
                <span>Search papers</span>
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOffset(0);
                  }}
                  placeholder="Title, author, or abstract"
                />
              </label>
              <label className="field">
                <span>Conference</span>
                <select
                  value={conference}
                  onChange={(e) => {
                    setConference(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">All conferences</option>
                  {(found.data?.conferences || ["NSDI", "SIGCOMM"]).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Year</span>
                <input
                  type="number"
                  placeholder="Any year"
                  value={year}
                  onChange={(e) => {
                    setYear(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
              <label className="field">
                <span>Topic</span>
                <select
                  value={topic}
                  onChange={(e) => {
                    setTopic(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">All topics</option>
                  {found.data?.topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <OrderSelect
                value={order}
                onChange={(v) => {
                  setOrder(v);
                  setOffset(0);
                }}
              />
            </div>
          ) : (
            <label className="field">
              <span>Source folder</span>
              <select
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setSelected(new Set());
                }}
              >
                <option value="">Choose a folder</option>
                {sources.map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.owner.displayName} / {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="selection-bar">
            <span>
              {selected.size} selected · {candidates.length} available in these
              results
            </span>
            <button
              disabled={pending || !candidates.length}
              onClick={() =>
                setSelected((old) => new Set([...old, ...candidates]))
              }
            >
              Select all results
            </button>
            <button
              disabled={!selected.size}
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </button>
          </div>
          <div className="picker-results" aria-busy={pending}>
            {(mode === "browse" ? found.loading : sourceData.loading) ? (
              <Loading />
            ) : (
              visible.map((p) => (
                <label
                  className={`picker-row ${existing.has(p.id) ? "disabled" : ""}`}
                  key={p.id}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    disabled={pending || existing.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <span>
                    <strong>{p.title}</strong>
                    <small>
                      {p.conference} {p.year}
                      {existing.has(p.id) ? " · Already in this folder" : ""}
                    </small>
                  </span>
                </label>
              ))
            )}
          </div>
          {mode === "browse" && (
            <div className="pagination">
              <button
                disabled={pending || offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - 40))}
              >
                Previous results
              </button>
              <span>
                {offset + 1}–{Math.min(offset + 40, found.data?.total || 0)} of{" "}
                {found.data?.total || 0}
              </span>
              <button
                disabled={pending || offset + 40 >= (found.data?.total || 0)}
                onClick={() => setOffset((o) => o + 40)}
              >
                Next results
              </button>
            </div>
          )}
          <div className="modal-actions">
            <span className="hint">
              Selections are kept across pages and filters.
            </span>
            <button
              className="primary"
              disabled={action.busy || !selected.size}
              onClick={() =>
                void action.run(async () => {
                  const result = await api<{ papers: PaperView[] }>(
                    "/papers/selection",
                    "POST",
                    {
                      paperIds:
                        mode === "folder"
                          ? visible
                              .filter((p) => selected.has(p.id))
                              .map((p) => p.id)
                          : [...selected],
                    },
                  );
                  setPreview(result.papers.filter((p) => !existing.has(p.id)));
                })
              }
            >
              Review {selected.size} papers
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
export function CollaboratorsDialog({
  folder,
  onClose,
  onSaved,
}: {
  folder: FolderDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState("");
  const people = useResource<{ users: User[] }>(
    `/users?q=${encodeURIComponent(query)}`,
  );
  const action = useAction();
  const existing = new Set([
    folder.owner.id,
    ...folder.collaborators.map((u) => u.id),
  ]);
  return (
    <Modal title="Manage collaborators" onClose={onClose}>
      <p>
        Collaborators can edit papers, notes, order and descriptions. Only you
        control visibility and membership.
      </p>
      <Notice>{action.error}</Notice>
      <div className="member-list">
        {folder.collaborators.length === 0 ? (
          <p className="muted">No collaborators yet.</p>
        ) : (
          folder.collaborators.map((u) => (
            <div className="split" key={u.id}>
              <span>
                {u.displayName} <small>@{u.username}</small>
              </span>
              <button
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await api(`/folders/${folder.id}/collaborators`, "PUT", {
                      revision: folder.revision,
                      userId: u.id,
                      add: false,
                    });
                    onSaved();
                  })
                }
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
      <label className="field">
        <span>Find a member</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or username"
        />
      </label>
      <label className="field">
        <span>Add collaborator</span>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Choose a member</option>
          {people.data?.users
            .filter((u) => !existing.has(u.id))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} (@{u.username})
              </option>
            ))}
        </select>
      </label>
      <button
        disabled={action.busy || !selected}
        className="primary"
        onClick={() =>
          void action.run(async () => {
            await api(`/folders/${folder.id}/collaborators`, "PUT", {
              revision: folder.revision,
              userId: selected,
              add: true,
            });
            onSaved();
          })
        }
      >
        Add collaborator
      </button>
    </Modal>
  );
}
