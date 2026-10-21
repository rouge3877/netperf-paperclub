import type { Store } from "./db.ts";
import type { Config } from "./config.ts";
import { communityFeed } from "./community.ts";
import {
  currentUser,
  register,
  login,
  logout,
  changePassword,
  authLimit,
} from "./auth.ts";
import { oidcService } from "./oidc.ts";
import { searchPapers, getPaper, ratePaper, listPapers } from "./papers.ts";
import { proposals, proposalPage, createProposal, vote } from "./topics.ts";
import {
  listFolders,
  createFolder,
  getFolder,
  updateFolder,
  deleteFolder,
  addPapers,
  removePapers,
  reorder,
  collaborate,
  forkFolder,
  starFolder,
  updateProgress,
  updateNote,
} from "./folders.ts";
import {
  listComments,
  recentPaperComments,
  addComment,
  changeComment,
} from "./comments.ts";
import { check, HttpError, ids } from "./errors.ts";
import {
  requireAdmin,
  listUsers,
  updateUser,
  createInvitation,
} from "./admin.ts";
const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      ...headers,
    },
  });
export function createApp(
  db: Store,
  config: Config,
  external = oidcService(db, config),
) {
  return async (request: Request, ip = "local"): Promise<Response> => {
    try {
      const url = new URL(request.url),
        path = url.pathname.split("/").filter(Boolean);
      const method = request.method;
      let body: Record<string, unknown> = {};
      if (!["GET", "HEAD"].includes(method)) {
        check(
          request.headers.get("Origin") === config.origin,
          403,
          "Use this site to perform this action.",
        );
        check(
          !["cross-site", "same-site"].includes(
            request.headers.get("Sec-Fetch-Site") || "",
          ),
          403,
          "Cross-site requests are not allowed.",
        );
        check(
          request.headers.get("Content-Type")?.split(";")[0] ===
            "application/json",
          415,
          "Send JSON.",
        );
        const raw = await request.text();
        check(
          Buffer.byteLength(raw) <= 2 * 1024 * 1024,
          413,
          "Request is too large.",
        );
        try {
          body = JSON.parse(raw);
        } catch {
          throw new HttpError(400, "Invalid JSON.");
        }
        check(
          body && typeof body === "object" && !Array.isArray(body),
          400,
          "Send a JSON object.",
        );
      }
      if (url.pathname === "/api/auth" && method === "GET")
        return json({
          user: currentUser(db, config, request),
          localAuth: config.localAuth,
          registration: config.registration,
          oidc: config.oidc ? { label: config.oidc.label } : null,
          hasUsers: !!db.get("SELECT 1 FROM users"),
        });
      if (path[1] === "auth") {
        if (
          ["login", "register", "password", "oidc"].includes(path[2]) &&
          method === "POST"
        )
          authLimit(
            db,
            ip,
            typeof body.username === "string"
              ? body.username.toLowerCase()
              : path[2],
          );
        if (path[2] === "register" && method === "POST") {
          const result = await register(db, config, body);
          return json({ user: result.user }, 201, {
            "Set-Cookie": result.cookie,
          });
        }
        if (path[2] === "login" && method === "POST") {
          const result = await login(db, config, body);
          return json({ user: result.user }, 200, {
            "Set-Cookie": result.cookie,
          });
        }
        if (path[2] === "logout" && method === "POST")
          return json({ ok: true }, 200, {
            "Set-Cookie": logout(db, config, request),
          });
        if (path[2] === "password" && method === "POST")
          return json({ ok: true }, 200, {
            "Set-Cookie": await changePassword(db, config, request, body),
          });
        if (path[2] === "oidc" && path[3] === "start" && method === "POST") {
          const result = await external.start(request, body);
          return json({ url: result.url }, 200, {
            "Set-Cookie": result.cookie,
          });
        }
        if (path[2] === "oidc" && path[3] === "callback" && method === "GET") {
          const result = await external.finish(request);
          const headers = new Headers({
            Location: "/",
            "Cache-Control": "no-store",
          });
          headers.append("Set-Cookie", result.cookie);
          headers.append("Set-Cookie", result.clear);
          return new Response(null, { status: 303, headers });
        }
      }
      const user = currentUser(db, config, request);
      check(user, 401, "Sign in to continue.");
      check(
        !user.mustChangePassword,
        403,
        "Change your initial password before continuing.",
        "password_change_required",
      );
      if (path[1] === "admin") {
        requireAdmin(db, user);
        if (path[2] === "users" && path.length === 3 && method === "GET")
          return json(listUsers(db, user, url.searchParams));
        if (path[2] === "users" && path.length === 4 && method === "PATCH")
          return json(updateUser(db, user, path[3], body));
        if (
          path[2] === "invitations" &&
          path.length === 3 &&
          method === "POST"
        ) {
          check(
            config.registration === "invite",
            400,
            "Invitations are available in invitation-only registration mode.",
          );
          return json(createInvitation(db), 201);
        }
        throw new HttpError(404, "Not found.");
      }
      if (path[1] === "community" && method === "GET") {
        if (!path[2])
          return json(
            communityFeed(db, user, Number(url.searchParams.get("offset"))),
          );
        if (path[2] === "comments")
          return json(
            recentPaperComments(
              db,
              user,
              Number(url.searchParams.get("offset")),
            ),
          );
        if (path[2] === "proposals")
          return json(proposalPage(db, user, url.searchParams));
      }
      if (path[1] === "users" && method === "GET") {
        const q = (url.searchParams.get("q") || "").slice(0, 80);
        return json({
          users: db.all(
            "SELECT id,username,display_name AS displayName FROM users WHERE username LIKE ? OR display_name LIKE ? ORDER BY display_name LIMIT 50",
            `%${q}%`,
            `%${q}%`,
          ),
        });
      }
      if (path[1] === "papers") {
        if (path[2] === "selection" && method === "POST") {
          const selected = ids(body.paperIds),
            known = new Map(
              listPapers(db, user)
                .filter((p) => p.available)
                .map((p) => [p.id, p]),
            );
          check(
            selected.every((id) => known.has(id)),
            400,
            "Some selected papers are no longer available.",
          );
          return json({ papers: selected.map((id) => known.get(id)!) });
        }
        if (!path[2] && method === "GET")
          return json(searchPapers(db, user, url.searchParams));
        if (path[2] && !path[3] && method === "GET")
          return json(getPaper(db, user, path[2]));
        if (path[3] === "rating" && method === "PUT") {
          ratePaper(db, user, path[2], body.score);
          return json({ ok: true });
        }
        if (path[3] === "proposals" && method === "GET")
          return json({ proposals: proposals(db, user, path[2]) });
        if (path[3] === "proposals" && method === "POST")
          return json(createProposal(db, user, path[2], body), 201);
      }
      if (path[1] === "proposals") {
        if (!path[2] && method === "GET")
          return json({ proposals: proposals(db, user) });
        if (path[3] === "vote" && method === "POST") {
          vote(db, user, path[2], body.choice);
          return json({ ok: true });
        }
      }
      if (path[1] === "folders") {
        if (
          path.length === 6 &&
          path[3] === "papers" &&
          path[5] === "note" &&
          method === "PUT"
        ) {
          updateNote(db, user, path[2], path[4], body);
          return json(getFolder(db, user, path[2]));
        }
        const id = path[2],
          action = path[3];
        if (!id && method === "GET")
          return json({
            folders: listFolders(
              db,
              user,
              url.searchParams.get("scope") || "mine",
            ),
          });
        if (!id && method === "POST")
          return json(createFolder(db, user, body), 201);
        if (id && !action && method === "GET")
          return json(getFolder(db, user, id));
        if (id && !action && method === "PATCH") {
          updateFolder(db, user, id, body);
          return json(getFolder(db, user, id));
        }
        if (id && !action && method === "DELETE") {
          deleteFolder(db, user, id, body.revision);
          return json({ ok: true });
        }
        if (action === "papers" && method === "POST") {
          addPapers(db, user, id, body);
          return json(getFolder(db, user, id));
        }
        if (action === "papers" && method === "DELETE") {
          removePapers(db, user, id, body);
          return json(getFolder(db, user, id));
        }
        if (action === "order" && method === "PUT") {
          reorder(db, user, id, body);
          return json(getFolder(db, user, id));
        }
        if (action === "collaborators" && method === "PUT") {
          collaborate(db, user, id, body);
          return json(getFolder(db, user, id));
        }
        if (action === "fork" && method === "POST")
          return json(forkFolder(db, user, id, body), 201);
        if (action === "star" && method === "PUT") {
          starFolder(db, user, id, body.starred);
          return json(getFolder(db, user, id));
        }
        if (action === "progress" && method === "PUT")
          return json(updateProgress(db, user, id, body));
      }
      if (path[1] === "comments") {
        if (!path[2] && method === "GET")
          return json(
            listComments(
              db,
              user,
              {
                paperId: url.searchParams.get("paperId") || undefined,
                folderId: url.searchParams.get("folderId") || undefined,
              },
              Number(url.searchParams.get("offset")) || 0,
            ),
          );
        if (!path[2] && method === "POST")
          return json(addComment(db, user, body), 201);
        if (path[2] && method === "PATCH") {
          changeComment(db, user, path[2], body);
          return json({ ok: true });
        }
        if (path[2] && method === "DELETE") {
          changeComment(db, user, path[2], body, true);
          return json({ ok: true });
        }
      }
      throw new HttpError(404, "Endpoint not found.");
    } catch (error) {
      if (error instanceof HttpError)
        return json({ error: error.message, code: error.code }, error.status);
      if (error instanceof Error && error.message.includes("UNIQUE constraint"))
        return json(
          {
            error:
              "A conflicting record already exists. Refresh and try again.",
          },
          409,
        );
      console.error(
        "Request failed:",
        error instanceof Error ? error.name : "unknown",
      );
      return json(
        { error: "The server could not complete this request." },
        500,
      );
    }
  };
}
