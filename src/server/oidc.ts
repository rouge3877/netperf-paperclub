import * as oidc from "openid-client";
import { randomUUID } from "node:crypto";
import type { Store } from "./db.ts";
import type { Config } from "./config.ts";
import type { User } from "../shared/types.ts";
import {
  hash,
  cookieValue,
  currentUser,
  insertUser,
  sessionCookie,
} from "./auth.ts";
import { check } from "./errors.ts";
import { evaluateProposals } from "./topics.ts";
export function resolveIdentity(
  db: Store,
  config: Config,
  identity: { issuer: string; subject: string; name?: string },
  linkUser: string | null,
  invitationHash: string | null,
): User {
  return db.transaction(() => {
    const existing = db.get<{ user_id: string }>(
      "SELECT user_id FROM identities WHERE issuer=? AND subject=?",
      identity.issuer,
      identity.subject,
    );
    if (linkUser) {
      check(
        !existing || existing.user_id === linkUser,
        409,
        "This identity is already linked to another account.",
      );
      check(
        db.get(
          "SELECT 1 FROM users WHERE id=? AND disabled=0 AND require_password_change=0",
          linkUser,
        ),
        401,
        "Sign in again before linking.",
      );
      db.run(
        "INSERT OR IGNORE INTO identities VALUES (?,?,?)",
        identity.issuer,
        identity.subject,
        linkUser,
      );
      return db.get<User>(
        "SELECT id,username,display_name AS displayName FROM users WHERE id=?",
        linkUser,
      )!;
    }
    if (existing)
      return db.get<User>(
        "SELECT id,username,display_name AS displayName FROM users WHERE id=?",
        existing.user_id,
      )!;
    check(config.registration !== "closed", 403, "New accounts are disabled.");
    const username = `member-${randomUUID().slice(0, 8)}`;
    const user = insertUser(
      db,
      username,
      (identity.name || username).slice(0, 80),
    );
    if (config.registration === "invite") {
      check(
        invitationHash,
        403,
        "An invitation is required for a new account.",
      );
      const used = db.run(
        "UPDATE invitations SET used_by=? WHERE token_hash=? AND used_by IS NULL AND expires_at>?",
        user.id,
        invitationHash,
        Date.now(),
      );
      check(
        used.changes === 1,
        403,
        "The invitation is invalid, used or expired.",
      );
    }
    db.run(
      "INSERT INTO identities VALUES (?,?,?)",
      identity.issuer,
      identity.subject,
      user.id,
    );
    evaluateProposals(db);
    return user;
  });
}
export function oidcService(
  db: Store,
  config: Config,
  providerFactory?: () => Promise<oidc.Configuration>,
) {
  let provider: Promise<oidc.Configuration> | undefined;
  const getProvider = () => {
    check(config.oidc, 404, "External sign-in is not configured.");
    return (provider ??= (
      providerFactory
        ? providerFactory()
        : oidc.discovery(
            new URL(config.oidc.issuer),
            config.oidc.clientId,
            config.oidc.clientSecret,
            undefined,
            { timeout: 10 },
          )
    )
      .then((p) => {
        oidc.enableNonRepudiationChecks(p);
        return p;
      })
      .catch((e) => {
        provider = undefined;
        throw e;
      }));
  };
  const flowCookie = (state: string, maxAge: number) =>
    `paperclub_oidc=${state}; Path=/api/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secure ? "; Secure" : ""}`;
  return {
    async start(request: Request, input: Record<string, unknown>) {
      const p = await getProvider();
      const viewer = currentUser(db, config, request);
      check(
        input.link !== true || viewer,
        401,
        "Sign in before linking an identity.",
      );
      const state = oidc.randomState(),
        verifier = oidc.randomPKCECodeVerifier(),
        nonce = oidc.randomNonce();
      db.run("DELETE FROM oidc_flows WHERE expires_at<=?", Date.now());
      check(
        db.get<{ n: number }>("SELECT count(*) n FROM oidc_flows")!.n < 1000,
        429,
        "External sign-in is busy.",
      );
      db.run(
        "INSERT INTO oidc_flows VALUES (?,?,?,?,?,?)",
        hash(state),
        verifier,
        nonce,
        input.link === true ? viewer!.id : null,
        typeof input.invitation === "string" ? hash(input.invitation) : null,
        Date.now() + 600000,
      );
      const url = oidc.buildAuthorizationUrl(p, {
        redirect_uri: `${config.origin}/api/auth/oidc/callback`,
        scope: "openid profile",
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
      });
      return { url: url.href, cookie: flowCookie(state, 600) };
    },
    async finish(request: Request) {
      const url = new URL(request.url),
        state = url.searchParams.get("state");
      check(
        state && state === cookieValue(request, "paperclub_oidc"),
        400,
        "External sign-in expired or does not match this browser.",
      );
      const flow = db.get<{
        verifier: string;
        nonce: string;
        link_user: string | null;
        invitation_hash: string | null;
      }>(
        "SELECT * FROM oidc_flows WHERE state_hash=? AND expires_at>?",
        hash(state),
        Date.now(),
      );
      check(flow, 400, "External sign-in expired.");
      db.run("DELETE FROM oidc_flows WHERE state_hash=?", hash(state));
      const tokens = await oidc.authorizationCodeGrant(
        await getProvider(),
        url,
        {
          pkceCodeVerifier: flow.verifier,
          expectedState: state,
          expectedNonce: flow.nonce,
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims();
      check(
        claims && typeof claims.sub === "string",
        401,
        "The identity provider did not return a valid identity.",
      );
      if (flow.link_user)
        check(
          currentUser(db, config, request)?.id === flow.link_user,
          401,
          "Sign in again before linking this identity.",
        );
      const user = resolveIdentity(
        db,
        config,
        {
          issuer: claims.iss,
          subject: claims.sub,
          name: typeof claims.name === "string" ? claims.name : undefined,
        },
        flow.link_user,
        flow.invitation_hash,
      );
      return {
        cookie: sessionCookie(db, config, user.id),
        clear: flowCookie("", 0),
      };
    },
  };
}
