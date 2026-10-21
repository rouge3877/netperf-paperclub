import { afterEach, beforeEach, expect, it } from "vitest";
import * as oidc from "openid-client";
import { generateKeyPairSync, sign } from "node:crypto";
import { Store } from "../src/server/db.ts";
import { oidcService } from "../src/server/oidc.ts";
import { currentUser } from "../src/server/auth.ts";
import type { Config } from "../src/server/config.ts";
const issuer = "https://id.example";
const config: Config = {
  origin: "http://127.0.0.1:3000",
  database: ":memory:",
  corpus: "corpus",
  web: "dist/web",
  secure: false,
  registration: "open",
  localAuth: true,
  oidc: { issuer, clientId: "paperclub" },
};
let db: Store;
beforeEach(() => {
  db = new Store(":memory:").migrate();
});
afterEach(() => db.close());
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
function jwt(payload: Record<string, unknown>) {
  const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "test-key" }),
    ).toString("base64url"),
    body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const value = `${header}.${body}`;
  return `${value}.${sign("sha256", Buffer.from(value), privateKey).toString("base64url")}`;
}
function fixture(wrongNonce = false) {
  let nonce = "",
    challenge = "";
  const provider = new oidc.Configuration(
    {
      issuer,
      authorization_endpoint: issuer + "/authorize",
      token_endpoint: issuer + "/token",
      jwks_uri: issuer + "/jwks",
      response_types_supported: ["code"],
      id_token_signing_alg_values_supported: ["RS256"],
    },
    "paperclub",
  );
  oidc.enableNonRepudiationChecks(provider);
  provider[oidc.customFetch] = async (input, init) => {
    if (String(input).endsWith("/jwks"))
      return Response.json({
        keys: [
          {
            ...publicKey.export({ format: "jwk" }),
            kid: "test-key",
            use: "sig",
            alg: "RS256",
          },
        ],
      });
    const params = new URLSearchParams(String(init?.body));
    expect(params.get("redirect_uri")).toBe(
      config.origin + "/api/auth/oidc/callback",
    );
    expect(
      await oidc.calculatePKCECodeChallenge(params.get("code_verifier")!),
    ).toBe(challenge);
    return Response.json({
      access_token: "test-access",
      token_type: "Bearer",
      id_token: jwt({
        iss: issuer,
        sub: "external-user",
        aud: "paperclub",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: wrongNonce ? "wrong" : nonce,
        name: "External Reader",
      }),
    });
  };
  const service = oidcService(db, config, async () => provider);
  return {
    service,
    capture: (url: URL) => {
      nonce = url.searchParams.get("nonce")!;
      challenge = url.searchParams.get("code_challenge")!;
    },
  };
}
it("completes a signed authorization-code flow with PKCE, nonce, state and browser binding", async () => {
  const { service, capture } = fixture();
  const started = await service.start(
    new Request(config.origin + "/api/auth/oidc/start"),
    {},
  );
  const auth = new URL(started.url);
  capture(auth);
  expect(auth.searchParams.get("scope")).toBe("openid profile");
  const callback = `${config.origin}/api/auth/oidc/callback?state=${auth.searchParams.get("state")}&code=test-code`;
  await expect(service.finish(new Request(callback))).rejects.toThrow(
    /browser/,
  );
  const request = new Request(callback, {
    headers: { Cookie: started.cookie.split(";")[0] },
  });
  const finished = await service.finish(request);
  const user = currentUser(
    db,
    config,
    new Request(config.origin, {
      headers: { Cookie: finished.cookie.split(";")[0] },
    }),
  );
  expect(user?.displayName).toBe("External Reader");
  expect(db.all("SELECT * FROM identities")).toHaveLength(1);
  await expect(service.finish(request)).rejects.toThrow(/expired/);
});
it("rejects an identity token with the wrong nonce without creating an account", async () => {
  const { service, capture } = fixture(true);
  const started = await service.start(
    new Request(config.origin + "/api/auth/oidc/start"),
    {},
  );
  const auth = new URL(started.url);
  capture(auth);
  await expect(
    service.finish(
      new Request(
        `${config.origin}/api/auth/oidc/callback?state=${auth.searchParams.get("state")}&code=test-code`,
        { headers: { Cookie: started.cookie.split(";")[0] } },
      ),
    ),
  ).rejects.toThrow();
  expect(db.all("SELECT * FROM users")).toEqual([]);
});
