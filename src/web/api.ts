import { useEffect, useState } from "react";
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw error;
    throw new ApiError(
      "Cannot reach Paperclub. Check that the server is running, then try again.",
      0,
    );
  }
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth"))
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(result.error || "Request failed.", response.status);
  }
  return result as T;
}
export function useDebouncedValue<T>(value: T, delay = 200) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
export function useResource<T>(
  path: string | null,
  version = 0,
  keepPreviousData = false,
) {
  const [state, setState] = useState<{
    data: T | null;
    error: string;
    pending: boolean;
    path: string | null;
    version: number;
  }>({ data: null, error: "", pending: !!path, path, version });
  useEffect(() => {
    const controller = new AbortController();
    setState((old) => ({
      data: path && (old.path === path || keepPreviousData) ? old.data : null,
      error: "",
      pending: !!path,
      path,
      version,
    }));
    if (path)
      api<T>(path, "GET", undefined, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted)
            setState({ data, error: "", pending: false, path, version });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({
              data: null,
              error: error.message,
              pending: false,
              path,
              version,
            });
        });
    return () => controller.abort();
  }, [path, version, keepPreviousData]);
  const data =
    path && (state.path === path || keepPreviousData) ? state.data : null;
  const pending =
    !!path &&
    (state.pending || state.path !== path || state.version !== version);
  return { data, error: state.error, pending, loading: pending && !data };
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [errorStatus, setErrorStatus] = useState<number | null>(null);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setErrorStatus(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setErrorStatus(e instanceof ApiError ? e.status : null);
    } finally {
      setBusy(false);
    }
  }
  return {
    busy,
    error,
    errorStatus,
    run,
    clear: () => {
      setError("");
      setErrorStatus(null);
    },
  };
}
export const navigate = (path: string) => {
  window.location.hash = path;
  window.scrollTo(0, 0);
};
