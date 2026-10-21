import { resolve } from "node:path";
export interface Config {
  origin: string;
  database: string;
  corpus: string;
  web: string;
  secure: boolean;
  registration: "invite" | "open" | "closed";
  localAuth: boolean;
  oidc?: {
    issuer: string;
    clientId: string;
    clientSecret?: string;
    label: string;
  };
}
export function configFromEnv(): Config {
  const origin = process.env.APP_ORIGIN || "http://127.0.0.1:3000";
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password)
    throw new Error(
      "APP_ORIGIN must be an exact origin without a trailing slash.",
    );
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("Use HTTPS for a non-loopback APP_ORIGIN.");
  const registration = process.env.REGISTRATION || "invite";
  if (!["invite", "open", "closed"].includes(registration))
    throw new Error("Invalid REGISTRATION mode.");
  const localAuth = process.env.LOCAL_AUTH !== "false";
  const issuer = process.env.OIDC_ISSUER;
  if (!localAuth && !issuer)
    throw new Error("Enable at least one sign-in method.");
  if (issuer && (!issuer.startsWith("https://") || !process.env.OIDC_CLIENT_ID))
    throw new Error("OIDC requires an HTTPS issuer and client ID.");
  return {
    origin,
    secure: url.protocol === "https:",
    registration: registration as Config["registration"],
    localAuth,
    database: resolve(process.env.DATABASE_PATH || "var/paperclub.sqlite"),
    corpus: resolve(process.env.CORPUS_PATH || "corpus"),
    web: resolve("dist/web"),
    oidc: issuer
      ? {
          issuer,
          clientId: process.env.OIDC_CLIENT_ID!,
          clientSecret: process.env.OIDC_CLIENT_SECRET,
          label: process.env.OIDC_LABEL || "Organization sign-in",
        }
      : undefined,
  };
}
