# Validation

Validated on 2026-10-21. Run `npm run verify` after changing the project and `npm run audit` after dependency changes.

| Check                           | Result                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Production build and TypeScript | Passed                                                                                                             |
| Canonical corpus                | 1,919 English records, exactly seven fields, unique IDs and matching paths                                         |
| Original English preservation   | All 1,919 source records preserved exactly                                                                         |
| Unit and API tests              | 42 passed                                                                                                          |
| Browser workflows               | 10 passed, including administrator setup and member management                                                     |
| Clean native installation       | Dependency installation, production build, initialization and HTTP startup passed from the Git submission file set |
| Initialization and restart      | Random admin password, required password change, repeat-init safety and session persistence passed                 |
| Existing data upgrade           | Additive migration passed; existing business records preserved                                                     |
| Repository hygiene              | Corpus included; databases, credentials, topic seeds, backups, reports and local tooling state excluded            |

Dependency audit: zero known vulnerabilities across production and development dependencies. Backup regression tests cover old schemas, live WAL state, unchanged source data, exclusive destination creation, private file permissions and missing-source errors. Administration no longer triggers implicit corpus synchronization.

Tests cover local/OIDC authentication, request-origin checks, rate limits, password/session rotation, administrator authorization, privilege-injection denial, last-admin protection, account disabling/restoration, member edit conflicts and single-use invitations. Existing folder, note, ordering, reading-progress, collaboration, fork/star, comment, rating and topic-vote behavior remains covered. Connection-failure tests preserve the order preview and permit retry after reconnection.

Browser checks cover the three main destinations, stable filtering, bulk selection, contextual reading/discussion returns, initialization password changes and the user-management workflow. Desktop and mobile screenshots were inspected; overflow and automated accessibility checks passed for the admin page and existing core views. These are automated checks, not a complete manual accessibility audit. Tests reset mutable state before each workflow and use synthetic accounts. The Community workflow also passes when run alone. Styles are grouped by responsibility; desktop/mobile comparisons preserve the existing layout.

## Reproduce

```sh
npm ci
npm run verify
```

Browser tests need Chromium (`npx playwright install chromium` or `CHROMIUM_PATH`). The optional one-time preservation comparison needs the original local reference:

```sh
npm run corpus:compare -- var/migration/english-preservation.json
```

Generated screenshots and test reports belong under ignored `reports/`; databases and private initialization output belong under ignored `var/`.

## Limits

- This host has no container engine. GitHub Actions is configured to build and start the Compose service, check its health, and verify repeatable administrator initialization.
- OIDC protocol behavior is tested with a simulated provider. An organization's actual issuer, credentials and callback configuration require deployment-specific validation.
