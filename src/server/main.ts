import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { configFromEnv } from "./config.ts";
import { Store } from "./db.ts";
import { loadCorpus, syncCorpus } from "./corpus.ts";
import { createApp } from "./app.ts";
const config = configFromEnv();
const papers = loadCorpus(config.corpus);
const db = new Store(config.database).migrate();
syncCorpus(db, papers);
const app = createApp(db, config);
const security = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  ...(config.secure ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", config.origin);
    let response: Response;
    if (url.pathname.startsWith("/api/")) {
      const parts: Buffer[] = [];
      let size = 0;
      for await (const part of req) {
        size += part.length;
        if (size > 2 * 1024 * 1024) {
          res.writeHead(413, {
            "Content-Type": "application/json",
            ...security,
          });
          res.end('{"error":"Request is too large."}');
          return;
        }
        parts.push(part);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value !== undefined)
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
      response = await app(
        new Request(url, {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method || "GET")
            ? undefined
            : Buffer.concat(parts),
        }),
        req.socket.remoteAddress || "unknown",
      );
    } else if (url.pathname === "/healthz")
      response = Response.json({ ok: true });
    else {
      if (!["GET", "HEAD"].includes(req.method || "")) {
        res.writeHead(405, security);
        res.end();
        return;
      }
      const path = resolve(config.web, `.${decodeURIComponent(url.pathname)}`);
      if (!path.startsWith(config.web + sep) && path !== config.web) {
        res.writeHead(404, security);
        res.end();
        return;
      }
      const asset =
        url.pathname === "/" ? resolve(config.web, "index.html") : path;
      try {
        const content = await readFile(asset);
        const type =
          (
            {
              ".html": "text/html; charset=utf-8",
              ".js": "text/javascript; charset=utf-8",
              ".css": "text/css; charset=utf-8",
              ".svg": "image/svg+xml",
              ".ico": "image/x-icon",
            } as Record<string, string>
          )[extname(asset)] || "application/octet-stream";
        response = new Response(content, {
          headers: {
            "Content-Type": type,
            "Cache-Control":
              extname(asset) === ".html" ? "no-cache" : "public, max-age=3600",
          },
        });
      } catch {
        response = new Response(
          "Not found. Build the frontend with npm run build.",
          { status: 404 },
        );
      }
    }
    const headers: Record<string, string | string[]> = { ...security };
    response.headers.forEach((value, key) => {
      if (key !== "set-cookie") headers[key] = value;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) headers["Set-Cookie"] = cookies;
    res.writeHead(response.status, headers);
    res.end(
      req.method === "HEAD"
        ? undefined
        : Buffer.from(await response.arrayBuffer()),
    );
  } catch {
    if (!res.headersSent) res.writeHead(500, security);
    res.end("Request failed.");
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(`Paperclub ready: ${config.origin} (${papers.length} papers)`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
