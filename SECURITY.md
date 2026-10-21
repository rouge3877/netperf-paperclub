# Security

Every paper, topic, folder, comment, rating and member API requires an application session. Public folders are visible to authenticated members only. Private folders are limited to the owner and named collaborators. The server enforces visibility on individual reads, mutations, comments, copied membership and fork lineage.

Only owners change visibility, collaborators or delete a folder. Collaborators edit content. Reading progress remains personal; a saved position or star does not grant continuing access. Comments are rendered as text, never interpreted as HTML.

Sessions use random opaque tokens with only hashes stored in SQLite. Cookies are HttpOnly and SameSite=Lax to support external login callbacks, with Secure enabled for HTTPS. Writes require exact configured Origin and JSON. Local HTTP configuration is restricted to loopback origins. Password work is bounded and authentication attempts are throttled. HTTP request logs omit identities and passwords; the initialization CLI prints its generated administrator password once for the operator.

OIDC uses a maintained protocol library, PKCE, state, nonce and signed token validation. Issuer/subject pairs resolve identity; arbitrary headers and matching emails do not authenticate or merge users. Linking requires an authenticated session before and after the provider round trip.

Registration defaults to invitations because every registered account participates in topic governance. `npm run init` creates the default administrator with a random password displayed once, which must be changed before accessing business APIs. There is no fixed or committed administrator password. Web administration requires a current active administrator role checked on every request; it never bypasses folder privacy. Disabled accounts cannot sign in through either local or OIDC authentication. Account disabling and role changes revoke sessions, and the last active administrator is protected. Server operators can recover accounts through the CLI. A real public deployment still needs operational monitoring, backups and appropriate HTTPS proxy configuration.

Do not commit `.env`, SQLite databases, invitations, backups, test accounts or private activity. Report security issues privately rather than posting credentials or account records in public issues.
