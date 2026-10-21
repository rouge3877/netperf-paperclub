import { useState, type FormEvent } from "react";
import type { SessionUser } from "../shared/types.ts";
import { api, useAction } from "./api.ts";
import { Notice } from "./ui.tsx";
import { Brand } from "./Brand.tsx";
export interface AuthState {
  user: SessionUser | null;
  localAuth: boolean;
  registration: "invite" | "open" | "closed";
  oidc: { label: string } | null;
  hasUsers: boolean;
}
export function AuthScreen({
  config,
  onLogin,
}: {
  config: AuthState;
  onLogin: (user: SessionUser) => void;
}) {
  const [register, setRegister] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [invitation, setInvitation] = useState("");
  const action = useAction();
  function submit(e: FormEvent) {
    e.preventDefault();
    void action.run(async () => {
      const result = await api<{ user: SessionUser }>(
        `/auth/${register ? "register" : "login"}`,
        "POST",
        { username, password, displayName: name, invitation },
      );
      setPassword("");
      onLogin(result.user);
    });
  }
  return (
    <div className="auth-shell">
      <section className="auth-intro">
        <Brand />
        <div>
          <h1>
            Read. Think.
            <br />
            Connect.
          </h1>
          <p>A research library from NetPerf.</p>
        </div>
        <span className="auth-foot">NetPerf Research Group</span>
      </section>
      <main className="auth-panel">
        <div className="auth-form">
          <h2>
            {register ? "Join the conversation" : "Sign in to your library"}
          </h2>
          {!config.hasUsers && (
            <Notice>
              No accounts yet. The server operator can initialize the admin
              account with <code>npm run init</code>.
            </Notice>
          )}
          <Notice>{action.error}</Notice>
          {config.localAuth && (
            <form onSubmit={submit}>
              <label className="field">
                <span>Username{register ? " (public handle)" : ""}</span>
                <input
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              {register && (
                <label className="field">
                  <span>Display name</span>
                  <input
                    required
                    maxLength={80}
                    autoComplete="nickname"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              <label className="field">
                <span>Password</span>
                <input
                  required
                  type="password"
                  autoComplete={register ? "new-password" : "current-password"}
                  minLength={register ? 15 : undefined}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {register && (
                <p className="hint">
                  Use at least 15 characters. A passphrase works well.
                </p>
              )}
              {register && config.registration === "invite" && (
                <label className="field">
                  <span>Invitation code</span>
                  <input
                    required
                    value={invitation}
                    onChange={(e) => setInvitation(e.target.value)}
                  />
                </label>
              )}
              <button className="primary full" disabled={action.busy}>
                {action.busy
                  ? "Please wait…"
                  : register
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>
          )}
          {config.localAuth && config.registration !== "closed" && (
            <button
              className="text-button auth-toggle"
              onClick={() => {
                setRegister(!register);
                action.clear();
              }}
            >
              {register
                ? "Already a member? Sign in"
                : "Have an invitation? Create an account"}
            </button>
          )}
          {config.oidc && (
            <div className="oidc-box">
              {config.registration === "invite" && !register && (
                <label className="field">
                  <span>Invitation code (new members only)</span>
                  <input
                    value={invitation}
                    onChange={(e) => setInvitation(e.target.value)}
                  />
                </label>
              )}
              <button
                className="full"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const result = await api<{ url: string }>(
                      "/auth/oidc/start",
                      "POST",
                      { invitation },
                    );
                    window.location.assign(result.url);
                  })
                }
              >
                {config.oidc.label}
              </button>
            </div>
          )}
          <p className="hint">
            Need access or a password reset? Contact the server operator.
          </p>
        </div>
      </main>
    </div>
  );
}
export function AccountPage({
  config,
  onUpdated,
}: {
  config: AuthState;
  onUpdated: () => void;
}) {
  const action = useAction(),
    [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [done, setDone] = useState(false);
  return (
    <div className="narrow">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Your account</div>
          <h1>{config.user?.displayName}</h1>
          <p>@{config.user?.username}</p>
        </div>
      </div>
      <Notice>{action.error}</Notice>
      {config.user?.mustChangePassword && (
        <p className="hint">Change your initial password to continue.</p>
      )}
      {done && (
        <p role="status" className="success">
          Password updated. Other sessions have been signed out.
        </p>
      )}
      {config.localAuth && (
        <section className="panel">
          <h2>Change password</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                await api("/auth/password", "POST", {
                  currentPassword: current,
                  password: next,
                });
                setCurrent("");
                setNext("");
                setDone(true);
                onUpdated();
              });
            }}
          >
            <label className="field">
              <span>Current password</span>
              <input
                type="password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label className="field">
              <span>New password</span>
              <input
                type="password"
                required
                minLength={15}
                maxLength={128}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <button disabled={action.busy} className="primary">
              Update password
            </button>
          </form>
        </section>
      )}
      {config.oidc && !config.user?.mustChangePassword && (
        <section className="panel">
          <h2>Connected sign-in</h2>
          <p>
            Link your organization identity to this account. Your folders and
            progress stay with you.
          </p>
          <button
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const result = await api<{ url: string }>(
                  "/auth/oidc/start",
                  "POST",
                  { link: true },
                );
                window.location.assign(result.url);
              })
            }
          >
            Link {config.oidc.label}
          </button>
        </section>
      )}
    </div>
  );
}
