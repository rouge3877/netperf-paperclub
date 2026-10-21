# Contributing

Use Node.js 24 or newer. Install with `npm ci`, initialize the administrator with `npm run init`, and start development with `npm run dev`. Sign in with the generated password and change it before using the application.

Read [architecture](docs/ARCHITECTURE.md) before changing business rules and [data maintenance](docs/DATA.md) before editing papers. Maintain canonical IDs. Corpus records contain exactly seven fields; runtime topic assignments and user activity must not enter Git.

Run `npm run build` and `npm test`. Run `npm run test:e2e` for interface, authentication or permission changes. Browser tests use a separate database, reset mutable state before every test, and can use an installed Chromium through `CHROMIUM_PATH`. A workflow must pass on its own, for example `npm run test:e2e -- -g "unified folder tabs"`. Keep the single-worker configuration while sharing one test server. Use `npm run format` for consistent source formatting and `npm run format:check` to verify it. After dependency changes, run `npm run audit`; CI checks formatting and all dependency severities in addition to the build and tests.

Tests should exercise observable behavior, persistence and authorization. Cover both permitted and denied operations when changing folder access. Cover concurrent revision conflicts when changing shared mutations. Schema changes belong in a new numbered SQL migration; do not rewrite applied migrations.

Include the concrete behavior change and checks actually performed in pull requests. Never include local databases, credentials, topic seeds, generated reports or the ignored pre-refactor archive.
