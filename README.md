# NetPerf Paperclub

[中文](README.zh-CN.md)

A self-hosted paper reading and discussion service by **NetPerf**. React + Node.js + SQLite, with 1,919 curated English NSDI/SIGCOMM papers included in this repository.

- **All Paper** — search and filter the paper library.
- **Paper Folders** — public/private folders, collaborators, notes, bulk additions, ordering, personal reading progress, forks and stars.
- **Community** — comments, editable ratings and topic proposals decided by a strict majority of registered users.
- **Accounts** — local login, optional OpenID Connect and an admin page for member access and invitations. The web interface is English-only.

## Quick start

Requires **Node.js 24+**.

```sh
npm ci
cp .env.example .env
npm run build
npm run init
npm start
```

Open [localhost:3000](http://127.0.0.1:3000). Sign in as **admin** with the random password printed by `init`, then change it when prompted. Initialization is safe to repeat: it never resets existing passwords or user data.

Use **Admin → Create invitation** to invite members. Administrators can search users, edit display names and roles, and disable or restore accounts. Change your own password from your account page. Registration defaults to invitation-only.

Keep the terminal running while using `npm start`. For background operation, Docker, upgrades and password recovery, see [Deployment](docs/DEPLOYMENT.md).

## Data and structure

```text
corpus/<conference>/<year>/<id>.json   Versioned English paper library
src/web/ · src/server/ · src/shared/  UI, API and shared contracts
db/migrations/                       Versioned database schema
tools/ · tests/ · docs/              Maintenance, checks and documentation
var/                                Local database and backups (ignored)
```

Each paper contains only `id`, `title`, `abstract`, `authors`, `conference`, `year` and `url`. Topics, accounts, folders, notes, comments, ratings and reading progress live in SQLite, outside Git. The collection is curated and does not claim complete conference coverage. See [Data maintenance](docs/DATA.md).

## Development

```sh
npm run dev       # Web :5173, API :3000 (stop npm start first)
npm run verify    # Build, unit/API tests and browser tests
```

Browser tests require Chromium: `npx playwright install chromium`, or set `CHROMIUM_PATH`. Tests use a separate database. GitHub Actions runs the same checks.

[Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

Application code and documentation: [MIT](LICENSE). Academic content retains its original rights; see [NOTICE](NOTICE).
