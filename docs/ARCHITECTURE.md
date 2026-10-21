# Paperclub architecture

Paperclub is an English-only, self-hosted multi-user web service. One Node.js process serves the React frontend and authenticated HTTP API. SQLite stores mutable state. Docker is optional.

## Modules

- `corpus/<conference>/<year>/<id>.json`: the only maintained business data in Git. Exactly seven fields: id, title, abstract, authors, conference, year, url.
- `src/web/`: paper browsing, folder management, personal reading, proposals, comments and account UI.
- `src/web/styles/`: shared controls and tokens, application layout, papers, folders, community and accounts. `styles.css` defines their import order; responsive rules stay with their owning module.
- `src/server/auth.ts`, `oidc.ts`: local credentials and optional external identity resolve to one internal user and opaque session.
- `src/server/admin.ts`, `src/web/Admin.tsx`: one-time administrator initialization, member access and invitation management.
- `src/server/papers.ts`, `topics.ts`: authenticated corpus access, ratings and majority-based topic governance.
- `src/server/folders.ts`: ownership, collaborators, visibility, membership, ordering, fork/star and user-specific reading progress.
- `src/server/comments.ts`: comments with inherited target access and author-only mutations.
- `src/server/community.ts`: merged paper activity, with open proposals pinned before pagination.
- `src/server/db.ts`, `db/migrations/`: transactional storage and versioned schema. Opening a store does not migrate it; startup and initialization explicitly call `migrate()`.
- `src/server/backup.ts`: a read-only connection snapshots the existing database independently of application configuration, schema migration and corpus synchronization.
- `src/shared/`: browser/server contracts and deterministic ordering.
- `tools/`: build, corpus checks, account administration and optional topic import.
- `tests/`: corpus, API, concurrency/permissions and browser checks.
- `var/`: ignored local database, backups and optional seed files. `dist/`: ignored build output.

## Navigation and reading UI

The header has three destinations: **All Paper**, **Paper Folders**, and **Community**. Folder detail and personal reading remain under Paper Folders. My Folders, Shared Folders and Starred are secondary routes within that destination. Older Explore, Starred and Topics URLs continue to resolve to the corresponding new views.

All Paper uses the original reference's reading layout: a narrow facet sidebar and a continuous full-abstract column. Single-paper reading belongs to ordered folders; legacy single-view library bookmarks normalize to the continuous list. Conference, year and topic choices are OR-ed within each facet and AND-ed across facets. Repeated URL parameters carry these selections. The last library query and position are also kept as a browser-session preference for returning from paper details. Theme choice is a browser preference; it does not modify paper or community data. On smaller screens the filters use a keyboard-accessible modal.

`Community.tsx` renders one shared activity layout for comments and proposals. `GET /api/community` merges paper comments and all proposals, puts open proposals first, then sorts by creation time with deterministic tie breaking before applying a single 20-item page. Adopted and superseded proposals remain in the chronological stream. Folder comments are excluded regardless of visibility. The endpoint requires a session and queries existing tables without copying feed data. Discussion links open the associated paper and scroll to its comment thread. The older comment-only and proposal-only endpoints remain compatible.

Search waits 200 ms after typing. Query refreshes retain the displayed results until the new response arrives; controls that act on those results are disabled while pending. Aborted responses are ignored. Different resource identities clear their data unless the caller explicitly opts into retaining a query result. Stable scrollbar space and a fixed-height bulk picker avoid layout shifts. Dialogs lock background scrolling and restore focus without scrolling. Short transitions respect the system's reduced-motion preference.

Internal links carry a validated `from` route rather than guessing their origin from the destination. The origin includes library filters/page, folder collection scope, or the current reading paper. `navigation.ts` centralizes those links, return labels, active navigation and return-to-item scrolling. Reading positions are also represented in the URL, so discussion round trips, reloads and browser Back/Forward preserve the paper. Community pagination remains in its URL.

Folder details use compact rows with on-demand abstracts. `FolderContents.tsx` owns selection, an explicit order preview and one inline note editor. Arrow movement, drag/drop, selected-item movement and bulk sorting share the same preview; save submits a full permutation against its captured folder revision. Content actions are disabled during edits and requests. Failed saves preserve the draft with an explicit discard/reload action. Settings, collaborators, fork and deletion are grouped under Manage.

## Papers and initialization

Corpus files are canonical. Startup validates all records, then transactionally upserts paper content without modifying topics or user activity. Removed source records become unavailable; references and historical discussions remain intact.

The optional topic seed is exported from the previous application outside Git. It contains topic names and paper assignments only. Import is allowed only before any topics or proposals exist and is recorded so it cannot overwrite later decisions. A new installation works without a seed.

## Identity and access

Every business API requires a session. Public means visible to all signed-in members. Local accounts and OIDC identities map to stable internal users. Identity matching uses issuer plus subject, never email. External linking requires an existing authenticated session.

Registration defaults to invitation-only. `npm run init` creates a default `admin` with a random password printed once, records initialization, and requires a password change before business APIs become accessible. Repeating initialization never resets credentials. The Admin page searches members, edits display names/roles, disables/restores accounts and generates invitations. Role and enabled status are checked from the database on every request; disabling and role changes revoke sessions. Optimistic revisions prevent stale member edits; the last active administrator is protected. Admin access grants no private-folder bypass. The CLI provides local recovery and explicit role assignment. Deployments may explicitly enable open registration. Sessions store token hashes; browser cookies are HTTP-only. Mutations require the configured exact Origin and JSON. Non-loopback deployments require an HTTPS public origin. Forwarded identity headers are not trusted.

## Paper Folders

A folder has one owner, a fixed ordered/unordered mode, public/private visibility and revision. Collaborators can edit its name, description, papers, per-item notes and order. Only the owner changes visibility or collaborators or deletes it. Public viewers can comment, fork, star and use their own reading progress.

Unordered folder sorting is a display preference. Ordered folders persist a unique paper sequence. Adding papers deduplicates and supports explicit insertion or copying from another currently accessible folder. Saved ordering is a snapshot of the chosen sort; changing ratings never silently reorders it. Concurrent edits check the folder revision.

Forks are independent private folders by default, copying content, order and per-item notes but no collaborators, stars, comments or progress. Source details are only disclosed while the source is accessible.

Each `folder_items` row has a plain-text note (up to 5,000 characters). `PUT /api/folders/:folder/papers/:paper/note` uses the same access and revision checks as other folder edits. Notes inherit folder visibility and are distinct from personal reading progress and paper comments. Reordering updates positions in place so notes remain attached to paper IDs. Removing an item removes its note; re-adding it starts with an empty note. Migration `003_folder_notes.sql` adds the column without changing existing rows or corpus data.

Personal completion is keyed by user, folder and paper. The current-paper pointer is separate. Reordering preserves completion; additions are unread; removed papers do not affect current totals. Readers follow current folder content and fork when they want an independent plan. Reading state never grants access after revocation.

## Topics

A proposal stores a paper's topic revision, before/after topics and a required reason. Its content is immutable. Each user has one changeable yes/no vote, or may withdraw it while open. Adoption requires more than half of all registered users: floor(N/2)+1. Administrators and disabled accounts remain registered users; changing account status does not change this denominator or remove existing votes.

Voting and new membership evaluate pending proposals within a transaction. Adoption records the denominator and approvals, updates assignments and increments the topic revision. Older incompatible proposals become superseded. Later user growth never reverses a completed decision. New topic names are created only when their proposal passes; there is no direct editing bypass.

The proposal editor maintains an array of selected complete topic names. Commas are part of a name, not a separator. Users may toggle existing names or explicitly add a new name before submitting their reason.

## Discussion and ratings

Comments belong to a paper or folder, inherit target access, and may be edited or deleted only by their author. Private target details do not escape through comment endpoints. A user has one editable/removable 1–5 rating per paper. Responses include aggregates and the viewer's own rating. A folder star is a separate boolean association.

## Migration and validation

The pre-refactor checkout is archived under ignored `var/migration/`. All 1,919 current English records are compared field-for-field against the old rendered corpus; IDs and reviewed English corrections are preserved. Translations, bilingual controls and historical review artifacts are not build inputs.

Validation covers clean boot and restart, seed protection, authentication and OIDC identity mapping, private/collaborator access, simultaneous edits, fork/star, progress, comments, ratings, topic votes and browser workflows. Native deployment and Docker execution are reported separately.

Browser workflows run serially against a dedicated test server. Before every test, `tests/fixtures/browser-db.ts` resets mutable state and creates three synthetic members; only the corpus and schema are retained. Each workflow creates its own folders, comments and proposals, so filtered runs do not depend on earlier tests.
