import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, useResource, navigate } from "./api.ts";
import { AuthScreen, AccountPage, type AuthState } from "./Auth.tsx";
import { PapersPage, PaperPage } from "./Papers.tsx";
import { FoldersPage, FolderPage, ReadingPage } from "./Folders.tsx";
import { AddToFolder } from "./FolderDialogs.tsx";
import { CommunityPage } from "./Community.tsx";
import { Loading, Notice } from "./ui.tsx";
import { Brand } from "./Brand.tsx";
import { activeSection } from "./navigation.ts";
import { AdminPage } from "./Admin.tsx";
import "./styles.css";
function App() {
  const [authVersion, setAuthVersion] = useState(0),
    [route, setRoute] = useState(location.hash.slice(1) || "papers"),
    [add, setAdd] = useState<string[] | null>(null),
    [logoutError, setLogoutError] = useState("");
  const result = useResource<AuthState>("/auth", authVersion);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("paperclub-theme") === "dark"
        ? "dark"
        : "light";
    } catch {
      return "light";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("paperclub-theme", theme);
    } catch {
      /* Optional browser preference. */
    }
  }, [theme]);
  useEffect(() => {
    if (result.data) setAuth(result.data);
  }, [result.data]);
  useEffect(() => {
    const changed = () => {
      setRoute(location.hash.slice(1) || "papers");
      setAdd(null);
      window.scrollTo(0, 0);
    };
    const expired = () => {
      setAuth((old) => (old ? { ...old, user: null } : null));
      setAuthVersion((v) => v + 1);
    };
    window.addEventListener("hashchange", changed);
    window.addEventListener("session-expired", expired);
    return () => {
      window.removeEventListener("hashchange", changed);
      window.removeEventListener("session-expired", expired);
    };
  }, []);
  if (!auth)
    return result.error ? <Notice>{result.error}</Notice> : <Loading />;
  if (!auth.user)
    return (
      <AuthScreen
        config={auth}
        onLogin={(user) => {
          setAuth({ ...auth, user, hasUsers: true });
          navigate(user.mustChangePassword ? "account" : "papers");
        }}
      />
    );
  const path = route.split("?")[0];
  const [page, id, section] = path.split("/");
  const active = activeSection(route);
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <Brand />
        <nav aria-label="Main navigation">
          {[
            ["papers", "All Paper"],
            ["folders", "Paper Folders"],
            ["community", "Community"],
          ].map(([path, label]) => (
            <a
              key={path}
              className={active === path ? "active" : ""}
              aria-current={active === path ? "page" : undefined}
              href={`#${path}`}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="account-nav">
          {auth.user.role === "admin" && !auth.user.mustChangePassword && (
            <a
              href="#admin"
              aria-current={page === "admin" ? "page" : undefined}
            >
              Admin
            </a>
          )}
          <button
            className="theme-toggle"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            onClick={() => setTheme((v) => (v === "light" ? "dark" : "light"))}
          >
            <span aria-hidden="true">{theme === "light" ? "◐" : "◑"}</span>
          </button>
          <a
            href="#account"
            title="Account settings"
            aria-label="Account settings"
          >
            {auth.user.displayName}
          </a>
          <button
            className="text-button"
            onClick={() => {
              void api("/auth/logout", "POST", {})
                .then(() => {
                  setAuth({ ...auth, user: null });
                  setAdd(null);
                })
                .catch((e) => setLogoutError(e.message));
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main id="main-content" className="workspace" key={path} tabIndex={-1}>
        <Notice>{logoutError}</Notice>
        {auth.user.mustChangePassword ? (
          <AccountPage
            config={auth}
            onUpdated={() => setAuthVersion((v) => v + 1)}
          />
        ) : page === "admin" ? (
          auth.user.role === "admin" ? (
            <AdminPage
              config={auth}
              onAccountChanged={() => setAuthVersion((v) => v + 1)}
            />
          ) : (
            <Notice>Administrator access is required.</Notice>
          )
        ) : page === "paper" && id ? (
          <PaperPage
            id={id}
            onAdd={setAdd}
            showDiscussion={section === "discussion"}
          />
        ) : page === "folder" && id ? (
          <FolderPage id={id} />
        ) : page === "read" && id ? (
          <ReadingPage id={id} onAdd={setAdd} />
        ) : page === "folders" ? (
          <FoldersPage
            scope={id === "public" || id === "starred" ? id : "mine"}
          />
        ) : page === "explore" ? (
          <FoldersPage scope="public" />
        ) : page === "starred" ? (
          <FoldersPage scope="starred" />
        ) : page === "account" ? (
          <AccountPage
            config={auth}
            onUpdated={() => setAuthVersion((v) => v + 1)}
          />
        ) : page === "community" || page === "proposals" ? (
          <CommunityPage />
        ) : (
          <PapersPage onAdd={setAdd} />
        )}
      </main>
      <footer className="site-footer">
        <span>Built by NetPerf</span>
      </footer>
      {add && <AddToFolder paperIds={add} onClose={() => setAdd(null)} />}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
