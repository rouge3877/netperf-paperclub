CREATE INDEX comments_recent_papers
ON comments(created_at DESC, id DESC) WHERE paper_id IS NOT NULL;

CREATE INDEX topic_proposals_status_time
ON topic_proposals(status, created_at DESC, id DESC);
