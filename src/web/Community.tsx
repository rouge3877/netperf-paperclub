import { useEffect, useState } from "react";
import type { CommunityFeed } from "../shared/types.ts";
import { useResource } from "./api.ts";
import { ActivityMeta, ProposalCard } from "./Discussion.tsx";
import { Empty, Loading, Notice } from "./ui.tsx";
import { paperHref, routeParams } from "./navigation.ts";

export function CommunityPage() {
  const [offset, setOffset] = useState(() =>
      Math.max(0, Number(routeParams().get("offset")) || 0),
    ),
    [version, setVersion] = useState(0);
  const result = useResource<CommunityFeed>(
    `/community?offset=${offset}`,
    version,
    true,
  );
  const refresh = () => setVersion((v) => v + 1);
  useEffect(() => {
    history.replaceState(
      null,
      "",
      `#community${offset ? `?offset=${offset}` : ""}`,
    );
  }, [offset]);
  return (
    <div className="community-page">
      <div className="page-heading">
        <h1>Community</h1>
        <button
          className="refresh-button"
          onClick={refresh}
          disabled={result.pending}
          aria-label="Refresh activity"
          title="Refresh activity"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 7v5h-5M4 17v-5h5M19 11a7 7 0 0 0-12-4L4 10m1 3a7 7 0 0 0 12 4l3-3" />
          </svg>
        </button>
      </div>
      <Notice>{result.error}</Notice>
      <div
        className="community-feed"
        aria-label="Community activity"
        aria-busy={result.pending}
      >
        {result.loading ? (
          <Loading />
        ) : !result.data?.items.length ? (
          <Empty title="Start a conversation">
            Comment on a paper or propose a topic change.
          </Empty>
        ) : (
          result.data.items.map((item) =>
            item.type === "proposal" ? (
              <ProposalCard
                key={`proposal:${item.proposal.id}`}
                proposal={item.proposal}
                busy={result.pending}
                onChanged={refresh}
              />
            ) : (
              <article
                className="activity-item comment-activity"
                key={`comment:${item.comment.id}`}
                aria-label={`Comment: ${item.comment.paper.title}`}
              >
                <ActivityMeta
                  author={item.comment.author}
                  createdAt={item.comment.createdAt}
                  kind="Comment"
                  edited={item.comment.revision > 1}
                />
                <h2>
                  <a href={paperHref(item.comment.paper.id)}>
                    {item.comment.paper.title}
                  </a>
                </h2>
                <p className="comment-body">{item.comment.body}</p>
                <a
                  className="activity-link"
                  href={paperHref(item.comment.paper.id, true)}
                >
                  Discuss →
                </a>
              </article>
            ),
          )
        )}
      </div>
      {!!result.data && result.data.total > 20 && (
        <div className="pagination">
          <button
            disabled={result.pending || result.data.offset === 0}
            onClick={() => setOffset(Math.max(0, result.data!.offset - 20))}
          >
            Previous
          </button>
          <span>Page {Math.floor(result.data.offset / 20) + 1}</span>
          <button
            disabled={
              result.pending || result.data.offset + 20 >= result.data.total
            }
            onClick={() => setOffset(result.data!.offset + 20)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
