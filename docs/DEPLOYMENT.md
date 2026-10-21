# Deployment and administration

## Configuration

Copy `.env.example` to `.env`. Production and administration scripts read it automatically.

| Variable             | Default                 | Meaning                                         |
| -------------------- | ----------------------- | ----------------------------------------------- |
| `HOST`               | `127.0.0.1`             | Listening interface.                            |
| `PORT`               | `3000`                  | Listening port.                                 |
| `APP_ORIGIN`         | `http://127.0.0.1:3000` | Exact browser origin, without a trailing slash. |
| `DATABASE_PATH`      | `var/paperclub.sqlite`  | Persistent SQLite path.                         |
| `CORPUS_PATH`        | `corpus`                | Canonical paper directory.                      |
| `REGISTRATION`       | `invite`                | `invite`, `open`, or `closed`.                  |
| `LOCAL_AUTH`         | `true`                  | Enable username/password sign-in.               |
| `OIDC_ISSUER`        | unset                   | HTTPS OpenID Connect issuer.                    |
| `OIDC_CLIENT_ID`     | unset                   | Registered client ID.                           |
| `OIDC_CLIENT_SECRET` | unset                   | Client secret, if required by the provider.     |
| `OIDC_LABEL`         | Organization sign-in    | Name of the sign-in button.                     |

When exposing the service to other machines, put an HTTPS reverse proxy in front and set `APP_ORIGIN` to the browser-visible HTTPS origin. The app issues Secure cookies in this mode. HTTP origins are accepted only for loopback. The service uses the configured origin and socket address; arbitrary forwarded identity or IP headers are not trusted.

## Accounts

Initialize the default administrator locally after installing dependencies:

```sh
npm run init
```

This creates `admin` with a cryptographically random password, printed once to the terminal. Only its salted hash is stored. The first login requires changing this password. Repeating initialization preserves all accounts, credentials and activity. Existing installations gain the administrator without changing existing members. If a legacy account already uses the reserved name `admin`, initialization refuses to claim it: the server operator must first verify that account and explicitly use `npm run admin -- set-role admin admin`.

The Admin link appears beside account settings for administrators. It lists and searches members, edits display names and roles, and disables/restores accounts. Invite-only deployments can generate a seven-day, single-use invitation there or with `npm run admin -- invite`. Share the code with the intended member; it is not retrievable after closing the dialog. Other registration modes are configured through `.env`.

Disabling an account preserves its activity, revokes sessions and blocks local and OIDC sign-in. Re-enabling requires signing in again. Role changes also revoke sessions. The last active administrator cannot be demoted or disabled; users cannot disable themselves. Administrator status does not bypass private-folder permissions. Account deletion is intentionally not part of this page. All registered accounts, including administrators and disabled accounts, remain in the topic-vote denominator; disabling an account does not change governance thresholds or erase its past votes.

For command-line maintenance, `npm run admin -- create-user USERNAME "Display name"` creates an ordinary member with a hidden password prompt. `npm run admin -- set-role USERNAME admin` grants administrator access; use `member` to remove it. Usernames remain stable public handles. Enable local sign-in for initial setup; in OIDC-only deployments, link the intended administrator's identity before setting `LOCAL_AUTH=false`.

Reset a forgotten local password with `npm run admin -- reset-password admin` (or another username). This prompts for a temporary password, revokes existing sessions and requires a change at the next login. Users can also change their password from Account settings. Passwords need 15–128 characters; command-line maintenance also accepts stdin or `PAPERCLUB_PASSWORD`. Local credentials use salted scrypt. OIDC-only users do not need a local password.

## Running locally

`npm start` runs in the foreground. Closing its terminal stops the service, even if the webpage remains open. On Linux/macOS, run it independently from the project directory instead (stop an existing foreground instance first):

```sh
mkdir -p var
nohup node --env-file-if-exists=.env dist/server/main.mjs > var/server.log 2>&1 < /dev/null &
echo $! > var/server.pid
curl --fail http://127.0.0.1:3000/healthz
```

Inspect `var/server.log` for startup errors. This survives terminal closure, but does not automatically start after reboot; use Docker's restart policy or your service manager for that. If saving reports that Paperclub cannot be reached, restore the service and retry without refreshing or discarding unsaved changes.

## OpenID Connect

Configure an issuer and client ID (and secret when needed). Register this exact callback with the provider:

```text
https://your-paperclub.example/api/auth/oidc/callback
```

The implementation uses authorization code flow, PKCE, state, nonce, signed ID-token verification and a short-lived browser-bound flow cookie. It creates the usual application session after login. Tokens from the identity provider are not exposed to the frontend or stored as application sessions.

External identities are keyed by issuer and subject. Matching email or display name never merges accounts. To attach another login method to an existing account, sign in first and choose Link in Account settings. Under invitation-only registration, new external users also need an invitation; returning linked users do not. Under closed registration, existing identities can still sign in.

Protocol flows are tested against a local test provider. Each real deployment must supply its own client configuration and verify its provider callback settings.

## Docker

```sh
docker compose up -d --build
docker compose exec paperclub npm run init
```

Open `http://127.0.0.1:3000`. The named `paperclub-data` volume holds the database and survives container replacement. Do not use `docker compose down -v` when retaining data. The application runs as the unprivileged Node user.

For an initial topic import, copy the external seed into the container and run the same administration command:

```sh
docker compose cp /absolute/path/topics-seed.json paperclub:/tmp/topics-seed.json
docker compose exec paperclub npm run topics:import -- /tmp/topics-seed.json
```

Set the compose environment and exposed port appropriately for an HTTPS proxy. Secrets belong in environment configuration, never the image or Git.

## Backups and upgrades

Create a consistent SQLite backup while the service is running:

```sh
npm run admin -- backup /absolute/path/to/new-backup.sqlite
```

The destination must not already exist. Backup opens the source read-only and captures its current schema and data without running migrations or importing the corpus. It works with older database versions and does not require valid web or login configuration. On POSIX systems, the output is readable and writable only by its owner. Backups include private accounts and user activity, so keep them outside source control. To restore, stop the service, preserve the current database, replace the database with the backup, remove stale companion `-wal`/`-shm` files from the stopped instance, and start again.

Only startup and `npm run init` apply schema migrations and synchronize the corpus. Other administration commands operate on an existing database; after updating the application, run initialization before account maintenance.

Upgrade by taking a backup, stopping the running process, updating code and corpus, running `npm ci`, `npm run build` and `npm run init`, then restarting. Keep the database path unchanged. Startup verifies applied migration checksums and applies new migrations exactly once. Never edit an already-applied migration. Migration `004_user_administration.sql` gives existing users the member role, preserves their sessions and activity, and adds account status and revision fields; initialization then adds the default administrator if needed.

The legacy Cloudflare database has a different schema. This refactor preserves the English corpus and provides the optional topic seed; it does not guess ownership for historical globally shared folders. Existing legacy user databases must be explicitly exported and mapped before import. The original local checkout archive remains under `var/migration/` for recovery.
