CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE papers (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, abstract TEXT NOT NULL, authors TEXT NOT NULL,
 conference TEXT NOT NULL, year INTEGER NOT NULL, url TEXT NOT NULL,
 available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)), topic_revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE local_credentials (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, password_hash TEXT NOT NULL);
CREATE TABLE identities (issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(issuer,subject));
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE invitations (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_by TEXT REFERENCES users(id));
CREATE TABLE auth_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE oidc_flows (state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, link_user TEXT REFERENCES users(id) ON DELETE CASCADE, invitation_hash TEXT, expires_at INTEGER NOT NULL);
CREATE TABLE topics (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
CREATE TABLE paper_topics (paper_id TEXT NOT NULL REFERENCES papers(id), topic_id TEXT NOT NULL REFERENCES topics(id), PRIMARY KEY(paper_id,topic_id));
CREATE TABLE topic_proposals (
 id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id), author_id TEXT NOT NULL REFERENCES users(id),
 base_revision INTEGER NOT NULL, before_topics TEXT NOT NULL, after_topics TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','adopted','superseded')), created_at INTEGER NOT NULL,
 adopted_users INTEGER, adopted_yes INTEGER
);
CREATE INDEX proposals_paper ON topic_proposals(paper_id,created_at);
CREATE TABLE topic_votes (proposal_id TEXT NOT NULL REFERENCES topic_proposals(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, choice TEXT NOT NULL CHECK(choice IN ('yes','no')), PRIMARY KEY(proposal_id,user_id));
CREATE TABLE folders (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 ordered INTEGER NOT NULL CHECK(ordered IN (0,1)), visibility TEXT NOT NULL CHECK(visibility IN ('private','public')),
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 forked_from TEXT REFERENCES folders(id) ON DELETE SET NULL
);
CREATE INDEX folders_owner ON folders(owner_id);
CREATE TABLE folder_collaborators (folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(folder_id,user_id));
CREATE TABLE folder_items (folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE, paper_id TEXT NOT NULL REFERENCES papers(id), position INTEGER NOT NULL, PRIMARY KEY(folder_id,paper_id), UNIQUE(folder_id,position));
CREATE TABLE folder_stars (folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(folder_id,user_id));
CREATE TABLE reading_completed (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE, paper_id TEXT NOT NULL REFERENCES papers(id), completed_at INTEGER NOT NULL, PRIMARY KEY(user_id,folder_id,paper_id));
CREATE TABLE reading_positions (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE, paper_id TEXT REFERENCES papers(id), updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,folder_id));
CREATE TABLE ratings (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, paper_id TEXT NOT NULL REFERENCES papers(id), score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5), PRIMARY KEY(user_id,paper_id));
CREATE INDEX ratings_paper ON ratings(paper_id);
CREATE TABLE comments (
 id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id), paper_id TEXT REFERENCES papers(id), folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
 body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK((paper_id IS NOT NULL) != (folder_id IS NOT NULL))
);
CREATE INDEX comments_paper ON comments(paper_id,created_at,id);
CREATE INDEX comments_folder ON comments(folder_id,created_at,id);
