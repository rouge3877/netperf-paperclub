import { useState } from "react";
import type { AdminUser, AdminUsers } from "../shared/types.ts";
import type { AuthState } from "./Auth.tsx";
import { api, useAction, useDebouncedValue, useResource } from "./api.ts";
import { Empty, Loading, Modal, Notice } from "./ui.tsx";

export function AdminPage({
  config,
  onAccountChanged,
}: {
  config: AuthState;
  onAccountChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [invitation, setInvitation] = useState<{
    token: string;
    expiresAt: number;
  } | null>(null);
  const settledQuery = useDebouncedValue(query);
  const result = useResource<AdminUsers>(
    `/admin/users?q=${encodeURIComponent(settledQuery)}&offset=${offset}`,
    version,
    true,
  );
  const action = useAction();
  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Administration</div>
          <h1>Users</h1>
        </div>
        {config.registration === "invite" && (
          <button
            className="primary"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                setInvitation(await api("/admin/invitations", "POST", {}));
              })
            }
          >
            Create invitation
          </button>
        )}
      </div>
      <Notice>{action.error || result.error}</Notice>
      <div className="admin-toolbar">
        <label className="field">
          <span>Search users</span>
          <input
            type="search"
            value={query}
            maxLength={80}
            placeholder="Name or username"
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        {result.data && (
          <span className="muted">{result.data.total} users</span>
        )}
      </div>
      {result.loading ? (
        <Loading />
      ) : (
        result.data && (
          <>
            {!result.data.users.length && <Empty title="No users found" />}
            <ul
              className="admin-users"
              aria-label="Users"
              aria-busy={result.pending}
            >
              {result.data.users.map((user) => (
                <li key={user.id}>
                  <div>
                    <strong>{user.displayName}</strong>
                    <span className="muted">@{user.username}</span>
                  </div>
                  <span>
                    {user.role === "admin" ? "Administrator" : "Member"}
                  </span>
                  <span className="muted">
                    {user.disabled ? "Disabled" : "Active"}
                  </span>
                  <button
                    disabled={result.pending}
                    onClick={() => setEditing(user)}
                    aria-label={`Edit ${user.username}`}
                  >
                    Edit
                  </button>
                </li>
              ))}
            </ul>
            {result.data.total > 50 && (
              <div className="admin-pagination">
                <button
                  disabled={result.pending || offset === 0}
                  onClick={() => setOffset((v) => Math.max(0, v - 50))}
                >
                  Previous
                </button>
                <span>
                  {offset + 1}–{offset + result.data.users.length} of{" "}
                  {result.data.total}
                </span>
                <button
                  disabled={result.pending || offset + 50 >= result.data.total}
                  onClick={() => setOffset((v) => v + 50)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )
      )}
      {editing && (
        <UserEditor
          user={editing}
          self={editing.id === config.user?.id}
          onClose={() => {
            setEditing(null);
            setVersion((v) => v + 1);
          }}
          onSaved={() => {
            setEditing(null);
            setVersion((v) => v + 1);
            onAccountChanged();
          }}
        />
      )}
      {invitation && (
        <Modal title="Invitation code" onClose={() => setInvitation(null)}>
          <p>
            One use. Expires{" "}
            {new Date(invitation.expiresAt).toLocaleDateString()}.
          </p>
          <label className="field">
            <span>Share this code with the new member</span>
            <input
              readOnly
              value={invitation.token}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <p className="hint">
            The code is shown only here. Copy it before closing.
          </p>
          <button onClick={() => setInvitation(null)}>Done</button>
        </Modal>
      )}
    </div>
  );
}

function UserEditor({
  user,
  self,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  self: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user.displayName);
  const [role, setRole] = useState(user.role);
  const [enabled, setEnabled] = useState(!user.disabled);
  const action = useAction();
  return (
    <Modal
      title={`Edit @${user.username}`}
      onClose={() => {
        if (!action.busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            await api(`/admin/users/${user.id}`, "PATCH", {
              revision: user.revision,
              displayName: name,
              role,
              disabled: !enabled,
            });
            onSaved();
          });
        }}
      >
        <Notice>{action.error}</Notice>
        <label className="field">
          <span>Display name</span>
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Role</span>
          <select
            aria-label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as AdminUser["role"])}
          >
            <option value="member">Member</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={enabled}
            disabled={self}
            onChange={(e) => setEnabled(e.target.checked)}
          />{" "}
          Account enabled
        </label>
        <p className="hint">
          Disabling an account signs it out and keeps its folders, notes and
          comments. Role changes also require a new sign-in.
        </p>
        <div className="dialog-actions">
          <button type="button" disabled={action.busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={action.busy}>
            Save user
          </button>
        </div>
      </form>
    </Modal>
  );
}
