import { useState } from "react";
import type { Comment, Proposal, PaperView } from "../shared/types.ts";
import { api, useAction, useResource } from "./api.ts";
import { Loading, Modal, Notice } from "./ui.tsx";
import { paperHref } from "./navigation.ts";
export function Discussion({
  paperId,
  folderId,
}: {
  paperId?: string;
  folderId?: string;
}) {
  const [version, setVersion] = useState(0),
    [body, setBody] = useState(""),
    [editing, setEditing] = useState<Comment | null>(null),
    [edited, setEdited] = useState(""),
    [offset, setOffset] = useState(0),
    [deleting, setDeleting] = useState<Comment | null>(null);
  const action = useAction();
  const result = useResource<{ comments: Comment[]; total: number }>(
    `/comments?${new URLSearchParams({ ...(paperId ? { paperId } : { folderId: folderId! }), offset: String(offset) })}`,
    version,
  );
  return (
    <section className="discussion" id="discussion">
      <h2>
        Discussion{" "}
        {result.data && <span className="count">{result.data.total}</span>}
      </h2>
      <Notice>{result.error || action.error}</Notice>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await api("/comments", "POST", { paperId, folderId, body });
            setBody("");
            setVersion((v) => v + 1);
          });
        }}
      >
        <label className="field">
          <span>Add a comment</span>
          <textarea
            required
            maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share a question, observation, or useful context."
          />
        </label>
        <button className="primary" disabled={action.busy || !body.trim()}>
          Post comment
        </button>
      </form>
      {result.loading ? (
        <Loading />
      ) : (
        result.data?.comments.map((c) => (
          <article className="comment" key={c.id}>
            <div className="comment-meta">
              <strong>{c.author.displayName}</strong>
              <span>
                {new Date(c.createdAt).toLocaleDateString("en-US")}
                {c.revision > 1 ? " · edited" : ""}
              </span>
              {c.canEdit && (
                <div className="actions">
                  <button
                    className="text-button"
                    onClick={() => {
                      setEditing(c);
                      setEdited(c.body);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="text-button danger"
                    onClick={() => setDeleting(c)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
            <p>{c.body}</p>
          </article>
        ))
      )}
      {result.data && result.data.total > 50 && (
        <div className="pagination">
          <button
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - 50))}
          >
            Previous comments
          </button>
          <button
            disabled={offset + 50 >= result.data.total}
            onClick={() => setOffset((o) => o + 50)}
          >
            More comments
          </button>
        </div>
      )}
      {editing && (
        <Modal title="Edit comment" onClose={() => setEditing(null)}>
          <Notice>{action.error}</Notice>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                await api(`/comments/${editing.id}`, "PATCH", {
                  revision: editing.revision,
                  body: edited,
                });
                setEditing(null);
                setVersion((v) => v + 1);
              });
            }}
          >
            <label className="field">
              <span>Comment</span>
              <textarea
                required
                value={edited}
                maxLength={5000}
                onChange={(e) => setEdited(e.target.value)}
              />
            </label>
            <button disabled={action.busy} className="primary">
              Save comment
            </button>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal title="Delete comment?" onClose={() => setDeleting(null)}>
          <p>This removes your comment.</p>
          <Notice>{action.error}</Notice>
          <button
            className="danger"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api(`/comments/${deleting.id}`, "DELETE", {
                  revision: deleting.revision,
                });
                setDeleting(null);
                setVersion((v) => v + 1);
              })
            }
          >
            Delete comment
          </button>
        </Modal>
      )}
    </section>
  );
}
export function ActivityMeta({
  author,
  createdAt,
  kind,
  edited = false,
}: {
  author: Comment["author"];
  createdAt: number;
  kind: string;
  edited?: boolean;
}) {
  return (
    <div className="activity-meta">
      <strong>{author.displayName}</strong>
      <span>{kind}</span>
      <time
        dateTime={new Date(createdAt).toISOString()}
        title={new Date(createdAt).toLocaleString("en-US")}
      >
        {new Date(createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}
        {edited ? " · edited" : ""}
      </time>
    </div>
  );
}
export function ProposalCard({
  proposal: p,
  showPaper = true,
  busy = false,
  onChanged,
}: {
  proposal: Proposal;
  showPaper?: boolean;
  busy?: boolean;
  onChanged: () => void;
}) {
  const action = useAction();
  const added = p.after.filter(
    (topic) => !p.before.some((old) => old.id === topic.id),
  );
  const removed = p.before.filter(
    (topic) => !p.after.some((next) => next.id === topic.id),
  );
  const cast = (choice: "yes" | "no" | null) =>
    void action.run(async () => {
      await api(`/proposals/${p.id}/vote`, "POST", { choice });
      onChanged();
    });
  return (
    <article
      className="proposal activity-item"
      aria-label={`Topic proposal: ${p.paperTitle}`}
    >
      <div className="activity-top">
        <ActivityMeta author={p.author} createdAt={p.createdAt} kind="Topic" />
        <span className={`activity-status ${p.status}`}>
          {p.status === "open" ? "Pinned" : p.status}
        </span>
      </div>
      {showPaper && (
        <h2>
          <a href={paperHref(p.paperId)}>{p.paperTitle}</a>
        </h2>
      )}
      <div className="topic-change" aria-label="Topic changes">
        {added.map((topic) => (
          <span className="topic-added" key={topic.id}>
            + {topic.name}
          </span>
        ))}
        {removed.map((topic) => (
          <span className="topic-removed" key={topic.id}>
            − {topic.name}
          </span>
        ))}
      </div>
      <p className="comment-body">{p.reason}</p>
      <Notice>{action.error}</Notice>
      <div className="activity-actions">
        {p.status === "open" ? (
          <>
            <button
              className={p.myVote === "yes" ? "selected" : "quiet"}
              aria-pressed={p.myVote === "yes"}
              disabled={busy || action.busy}
              onClick={() => cast("yes")}
            >
              {p.myVote === "yes" ? "Approved" : "Approve"}
            </button>
            <button
              className={p.myVote === "no" ? "selected" : "quiet"}
              aria-pressed={p.myVote === "no"}
              disabled={busy || action.busy}
              onClick={() => cast("no")}
            >
              Oppose
            </button>
            {p.myVote && (
              <button
                className="text-button"
                disabled={busy || action.busy}
                onClick={() => cast(null)}
              >
                Withdraw vote
              </button>
            )}
            <span
              className="vote-count"
              title={`Requires approval from ${p.required} of ${p.users} members (strict majority).`}
            >
              {p.yes} for · {p.no} against · {p.required} required
            </span>
          </>
        ) : p.status === "adopted" ? (
          <span className="vote-count">
            Adopted with {p.adoptedYes} of {p.adoptedUsers}{" "}
            {p.adoptedUsers === 1 ? "member" : "members"}
          </span>
        ) : null}
        {showPaper && (
          <a className="activity-link" href={paperHref(p.paperId, true)}>
            Discuss →
          </a>
        )}
      </div>
    </article>
  );
}
export function ProposalList({
  paperId,
  version = 0,
  onChanged,
}: {
  paperId: string;
  version?: number;
  onChanged?: () => void;
}) {
  const [local, setLocal] = useState(0);
  const result = useResource<{ proposals: Proposal[] }>(
    `/papers/${paperId}/proposals`,
    version + local,
  );
  return (
    <section aria-busy={result.pending}>
      <Notice>{result.error}</Notice>
      {result.loading ? (
        <Loading />
      ) : !result.data?.proposals.length ? (
        <p className="muted">No proposals yet.</p>
      ) : (
        result.data.proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            showPaper={false}
            busy={result.pending}
            onChanged={() => {
              setLocal((v) => v + 1);
              onChanged?.();
            }}
          />
        ))
      )}
    </section>
  );
}
export function ProposeDialog({
  paper,
  onClose,
  onSaved,
}: {
  paper: PaperView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [topics, setTopics] = useState(paper.topics.map((t) => t.name)),
    [newTopic, setNewTopic] = useState(""),
    [reason, setReason] = useState("");
  const action = useAction();
  const options = useResource<{ topics: { id: string; name: string }[] }>(
    "/papers?limit=1",
  );
  return (
    <Modal title="Propose topic change" onClose={onClose}>
      <p>
        Explain the change. More than half of all members must approve it.
        Submitting does not cast your vote.
      </p>
      <Notice>{action.error}</Notice>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await api(`/papers/${paper.id}/proposals`, "POST", {
              revision: paper.topicRevision,
              topics,
              reason,
            });
            onSaved();
          });
        }}
      >
        <fieldset className="topic-picker">
          <legend>Proposed topics</legend>
          <div className="chips topic-options">
            {[
              ...new Set([
                ...paper.topics.map((t) => t.name),
                ...(options.data?.topics.map((t) => t.name) ?? []),
                ...topics,
              ]),
            ].map((name) => (
              <button
                type="button"
                className={`chip ${topics.includes(name) ? "selected" : ""}`}
                aria-pressed={topics.includes(name)}
                key={name}
                onClick={() =>
                  setTopics((old) =>
                    old.includes(name)
                      ? old.filter((t) => t !== name)
                      : [...old, name],
                  )
                }
              >
                {name}
              </button>
            ))}
          </div>
          <div className="new-topic">
            <label className="field">
              <span>New topic name</span>
              <input
                value={newTopic}
                maxLength={80}
                onChange={(e) => setNewTopic(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={!newTopic.trim()}
              onClick={() => {
                const name = newTopic.trim();
                setTopics((old) =>
                  old.some((t) => t.toLowerCase() === name.toLowerCase())
                    ? old
                    : [...old, name],
                );
                setNewTopic("");
              }}
            >
              Add topic
            </button>
          </div>
        </fieldset>
        <Notice>{options.error}</Notice>
        <p className="hint">
          {topics.length} selected. Select existing topics or add a new English
          name. Deselect all to propose removing all topics.
        </p>
        <label className="field">
          <span>Reason</span>
          <textarea
            required
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain how the paper supports this classification."
          />
        </label>
        <button className="primary" disabled={action.busy}>
          Submit proposal
        </button>
      </form>
    </Modal>
  );
}
