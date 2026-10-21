import { useEffect, useRef, useState } from "react";
import type { Folder, FolderDetail } from "../shared/types.ts";
import { api, navigate, useAction, useResource } from "./api.ts";
import { Back, Empty, Loading, Modal, Notice, PaperCard } from "./ui.tsx";
import {
  FolderForm,
  AddPapersDialog,
  CollaboratorsDialog,
} from "./FolderDialogs.tsx";
import { Discussion } from "./Discussion.tsx";
import { FolderContents } from "./FolderContents.tsx";
import {
  routeParams,
  returnRoute,
  returnLabel,
  withReturn,
  paperHref,
} from "./navigation.ts";
export function FoldersPage({
  scope,
}: {
  scope: "mine" | "public" | "starred";
}) {
  const [creating, setCreating] = useState(false);
  const result = useResource<{ folders: Folder[] }>(`/folders?scope=${scope}`);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Paper Folders</h1>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>
          New folder
        </button>
      </div>
      <nav className="tabs folder-tabs" aria-label="Folder collections">
        {(
          [
            ["mine", "My Folders"],
            ["public", "Shared Folders"],
            ["starred", "Starred"],
          ] as const
        ).map(([value, label]) => (
          <a
            key={value}
            href={`#folders/${value}`}
            className={scope === value ? "active" : ""}
            aria-current={scope === value ? "page" : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <Notice>{result.error}</Notice>
      {result.loading ? (
        <Loading />
      ) : !result.data?.folders.length ? (
        <Empty
          title={scope === "mine" ? "No folders yet" : "No folders here yet"}
        >
          {scope === "mine"
            ? "Create an ordered reading sequence or an unordered collection of papers."
            : "Public folders will appear here when members share them."}
        </Empty>
      ) : (
        <div className="folder-grid">
          {result.data.folders.map((f) => (
            <a
              className="folder-card"
              href={`#${withReturn(`folder/${f.id}`)}`}
              key={f.id}
            >
              <div className="split">
                <span className="folder-glyph">{f.ordered ? "☷" : "▤"}</span>
                <span className="badge">{f.visibility}</span>
              </div>
              <p className="folder-owner">{f.owner.displayName} /</p>
              <h2>{f.name}</h2>
              {f.description && (
                <p className="folder-description">{f.description}</p>
              )}
              <div className="folder-card-footer">
                <span>
                  {f.paperCount} papers · {f.ordered ? "Ordered" : "Unordered"}
                </span>
                <span>☆ {f.stars}</span>
              </div>
              {f.canEdit && !f.isOwner && (
                <span className="collaborator-label">Collaborator</span>
              )}
            </a>
          ))}
        </div>
      )}
      {creating && (
        <FolderForm
          onClose={() => setCreating(false)}
          onSaved={(id) => navigate(`folder/${id}`)}
        />
      )}
    </>
  );
}
export function FolderPage({ id }: { id: string }) {
  const [version, setVersion] = useState(0),
    [dialog, setDialog] = useState(""),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [dirty, setDirty] = useState(false),
    [forkName, setForkName] = useState(""),
    [forkOrdered, setForkOrdered] = useState(true);
  const result = useResource<FolderDetail>(`/folders/${id}`, version);
  const action = useAction();
  const refresh = () => {
    setDialog("");
    setSelected(new Set());
    setVersion((v) => v + 1);
  };
  if (result.loading) return <Loading />;
  if (!result.data) return <Notice>{result.error}</Notice>;
  const folder = result.data;
  const back = returnRoute("folders");
  const busy = result.pending || action.busy;
  return (
    <div className="folder-detail">
      <Back to={back} label={returnLabel(back)} />
      <div className="page-heading folder-heading">
        <div>
          <div className="folder-owner">{folder.owner.displayName}</div>
          <h1>{folder.name}</h1>
          {folder.description && (
            <p className="preserve-lines">{folder.description}</p>
          )}
          <div className="folder-meta">
            <span>{folder.visibility}</span>
            <span>{folder.ordered ? "Ordered" : "Unordered"}</span>
            <span>{folder.paperCount} papers</span>
            {folder.ordered && (
              <span>
                {folder.progress?.completed.length || 0} completed by you
              </span>
            )}
            {!!folder.collaborators.length && (
              <span>
                {folder.collaborators.length}{" "}
                {folder.collaborators.length === 1
                  ? "collaborator"
                  : "collaborators"}
              </span>
            )}
          </div>
          {folder.forkedFrom && (
            <p className="hint">
              Forked from{" "}
              <a href={`#folder/${folder.forkedFrom.id}`}>
                {folder.forkedFrom.owner} / {folder.forkedFrom.name}
              </a>
            </p>
          )}
        </div>
        {folder.ordered && folder.papers.length > 0 && (
          <a
            className="button-link primary"
            href={`#${withReturn(`read/${id}`)}`}
          >
            Continue reading
          </a>
        )}
      </div>
      <Notice>{action.error}</Notice>
      <div className="folder-toolbar">
        {folder.canEdit && (
          <button
            className="primary"
            disabled={busy || dirty}
            onClick={() => setDialog("add")}
          >
            Add papers
          </button>
        )}
        {folder.visibility === "public" && (
          <button
            className={folder.starred ? "selected" : "quiet"}
            disabled={busy}
            onClick={() =>
              void action.run(async () => {
                await api(`/folders/${id}/star`, "PUT", {
                  starred: !folder.starred,
                });
                setVersion((v) => v + 1);
              })
            }
          >
            {folder.starred ? "★ Starred" : "☆ Star"} · {folder.stars}
          </button>
        )}
        <details
          className="folder-menu"
          onClick={(event) => {
            if ((event.target as Element).closest("button"))
              event.currentTarget.open = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              event.currentTarget.open = false;
          }}
        >
          <summary>Manage</summary>
          <div>
            {folder.canEdit && (
              <button
                disabled={busy || dirty}
                onClick={() => setDialog("settings")}
              >
                Settings
              </button>
            )}
            {folder.isOwner && (
              <button
                disabled={busy || dirty}
                onClick={() => setDialog("collaborators")}
              >
                Collaborators
              </button>
            )}
            {(folder.visibility === "public" || folder.isOwner) && (
              <button
                disabled={busy || dirty}
                onClick={() => {
                  setForkName(`${folder.name} (copy)`);
                  setForkOrdered(folder.ordered);
                  setDialog("fork");
                }}
              >
                {folder.visibility === "public"
                  ? "Fork folder"
                  : "Duplicate folder"}
              </button>
            )}
            {folder.isOwner && (
              <button
                className="danger"
                disabled={busy || dirty}
                onClick={() => setDialog("delete")}
              >
                Delete folder
              </button>
            )}
          </div>
        </details>
      </div>
      <FolderContents
        folder={folder}
        pending={busy}
        onChanged={() => setVersion((v) => v + 1)}
        onDirtyChange={setDirty}
        onRemove={(ids) => {
          setSelected(new Set(ids));
          setDialog("remove");
        }}
      />
      <Discussion folderId={id} />
      {dialog === "add" && (
        <AddPapersDialog
          folder={folder}
          onClose={() => setDialog("")}
          onSaved={refresh}
        />
      )}{" "}
      {dialog === "settings" && (
        <FolderForm
          folder={folder}
          onClose={() => setDialog("")}
          onSaved={refresh}
        />
      )}{" "}
      {dialog === "collaborators" && (
        <CollaboratorsDialog
          folder={folder}
          onClose={() => setDialog("")}
          onSaved={refresh}
        />
      )}{" "}
      {dialog === "fork" && (
        <Modal title="Create your own copy" onClose={() => setDialog("")}>
          <p>
            Papers, order and notes are copied into a private folder. Comments,
            stars, collaborators and progress are not copied.
          </p>
          <Notice>{action.error}</Notice>
          <label className="field">
            <span>Copy name</span>
            <input
              required
              value={forkName}
              maxLength={120}
              onChange={(e) => setForkName(e.target.value)}
            />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={forkOrdered}
              onChange={(e) => setForkOrdered(e.target.checked)}
            />
            <span>Ordered folder with personal reading progress</span>
          </label>
          <button
            className="primary"
            disabled={action.busy || !forkName.trim()}
            onClick={() =>
              void action.run(async () => {
                const next = await api<{ id: string }>(
                  `/folders/${id}/fork`,
                  "POST",
                  { name: forkName, ordered: forkOrdered },
                );
                navigate(`folder/${next.id}`);
                setDialog("");
              })
            }
          >
            Create private copy
          </button>
        </Modal>
      )}
      {dialog === "remove" && (
        <Modal title="Remove selected papers?" onClose={() => setDialog("")}>
          <p>
            Remove {selected.size} papers from this folder. The papers remain in
            the library.
          </p>
          <Notice>{action.error}</Notice>
          <button
            disabled={action.busy}
            className="danger"
            onClick={() =>
              void action.run(async () => {
                await api(`/folders/${id}/papers`, "DELETE", {
                  revision: folder.revision,
                  paperIds: [...selected],
                });
                refresh();
              })
            }
          >
            Remove {selected.size} papers
          </button>
        </Modal>
      )}
      {dialog === "delete" && (
        <Modal title="Delete folder?" onClose={() => setDialog("")}>
          <p>
            This deletes this folder, its discussion and reading progress.
            Independent forks remain.
          </p>
          <Notice>{action.error}</Notice>
          <button
            className="danger"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api(`/folders/${id}`, "DELETE", {
                  revision: folder.revision,
                });
                navigate("folders");
              })
            }
          >
            Delete this folder
          </button>
        </Modal>
      )}
    </div>
  );
}
export function ReadingPage({
  id,
  onAdd,
}: {
  id: string;
  onAdd: (ids: string[]) => void;
}) {
  const [version, setVersion] = useState(0),
    [current, setCurrent] = useState<string | null>(() =>
      routeParams().get("paper"),
    ),
    [entryError, setEntryError] = useState("");
  const entered = useRef(false);
  const result = useResource<FolderDetail>(`/folders/${id}`, version);
  const action = useAction();
  const folder = result.data;
  const currentId = folder?.papers.some((p) => p.id === current)
    ? current
    : folder?.progress?.currentPaperId || folder?.papers[0]?.id || null;
  useEffect(() => {
    if (!folder?.ordered || !currentId) return;
    const params = routeParams();
    params.set("paper", currentId);
    history.replaceState(null, "", `#read/${id}?${params}`);
    if (!entered.current) {
      entered.current = true;
      if (currentId !== folder.progress?.currentPaperId)
        void api(`/folders/${id}/progress`, "PUT", {
          paperId: currentId,
          current: true,
        }).catch((error) => setEntryError(error.message));
    }
  }, [currentId, folder, id]);
  if (result.loading) return <Loading />;
  if (!folder) return <Notice>{result.error}</Notice>;
  if (!folder.ordered)
    return (
      <Notice>This folder is unordered and has no reading progress.</Notice>
    );
  const index = folder.papers.findIndex((p) => p.id === currentId),
    paper = folder.papers[index];
  const back = returnRoute(`folder/${id}`),
    backParams = routeParams(back);
  if (paper) backParams.set("focus", paper.id);
  const backTo = `${back.split("?")[0]}?${backParams}`;
  function move(next: number) {
    if (!folder || next < 0 || next >= folder.papers.length) return;
    void action.run(async () => {
      await api(`/folders/${id}/progress`, "PUT", {
        paperId: folder.papers[next].id,
        current: true,
      });
      setCurrent(folder.papers[next].id);
      window.scrollTo(0, 0);
    });
  }
  return (
    <div className="reading-view">
      <Back to={backTo} label={folder.name} />
      <div className="reading-header">
        <h1>{folder.name}</h1>
        <p>
          {folder.progress?.completed.length || 0} of {folder.papers.length}{" "}
          papers completed · Your progress is private
        </p>
        <progress
          aria-label="Reading completion"
          value={folder.progress?.completed.length || 0}
          max={folder.papers.length || 1}
        />
      </div>
      <Notice>{action.error || entryError}</Notice>
      {paper ? (
        <>
          <div className="reading-nav">
            <button
              disabled={action.busy || index <= 0}
              onClick={() => move(index - 1)}
            >
              ← Previous paper
            </button>
            <label className="field compact">
              <span>Current paper</span>
              <select
                value={paper.id}
                disabled={action.busy || result.pending}
                onChange={(e) =>
                  move(folder.papers.findIndex((p) => p.id === e.target.value))
                }
              >
                {folder.papers.map((p, i) => (
                  <option key={p.id} value={p.id}>
                    {i + 1}. {p.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={action.busy || index >= folder.papers.length - 1}
              onClick={() => move(index + 1)}
            >
              Next paper →
            </button>
          </div>
          <PaperCard paper={paper} full onAdd={() => onAdd([paper.id])} />
          {paper.note && (
            <aside className="reading-note" aria-label="Folder note">
              <h2>Folder note</h2>
              <p className="folder-note">{paper.note}</p>
            </aside>
          )}
          <div className="reading-actions">
            <button
              className={
                folder.progress?.completed.includes(paper.id)
                  ? "selected"
                  : "primary"
              }
              disabled={action.busy || result.pending}
              onClick={() =>
                void action.run(async () => {
                  await api(`/folders/${id}/progress`, "PUT", {
                    paperId: paper.id,
                    current: true,
                    completed: !folder.progress?.completed.includes(paper.id),
                  });
                  setVersion((v) => v + 1);
                })
              }
            >
              {folder.progress?.completed.includes(paper.id)
                ? "✓ Completed — mark unread"
                : "Mark as completed"}
            </button>
            <a href={paperHref(paper.id, true)}>Discuss & rate this paper →</a>
            <button
              className="text-button"
              aria-label="Continue to next paper"
              disabled={
                action.busy ||
                result.pending ||
                index >= folder.papers.length - 1
              }
              onClick={() => move(index + 1)}
            >
              Next →
            </button>
          </div>
        </>
      ) : (
        <Empty title="No papers to read">
          Add papers to this folder to start reading.
        </Empty>
      )}
    </div>
  );
}
