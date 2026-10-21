import { useEffect, useRef } from "react";

export const currentRoute = () => location.hash.slice(1) || "papers";
export function routeParams(route = currentRoute()) {
  return new URLSearchParams(route.split("?")[1] || "");
}
function validReturn(route: string | null): route is string {
  return (
    !!route &&
    route.length < 6000 &&
    /^(papers|community|folders(?:\/(?:mine|public|starred))?|(?:folder|read)\/[a-zA-Z0-9-]+)(?:\?[^#]*)?$/.test(
      route,
    )
  );
}
export function returnRoute(fallback = "papers", route = currentRoute()) {
  const from = routeParams(route).get("from");
  return validReturn(from) ? from : fallback;
}
export function withReturn(to: string, from = currentRoute()) {
  const params = routeParams(to);
  if (validReturn(from)) params.set("from", from);
  return `${to.split("?")[0]}${params.size ? `?${params}` : ""}`;
}
export function paperHref(id: string, discussion = false) {
  let from = currentRoute();
  if (from.startsWith("paper/")) from = returnRoute();
  const params = routeParams(from);
  if (from.startsWith("read/")) params.set("paper", id);
  else if (from.startsWith("papers") || from.startsWith("folder/"))
    params.set("focus", id);
  from = `${from.split("?")[0]}${params.size ? `?${params}` : ""}`;
  return `#${withReturn(`paper/${id}${discussion ? "/discussion" : ""}`, from)}`;
}
export function returnLabel(route: string) {
  if (route.startsWith("read/")) return "Back to reading";
  if (route.startsWith("folder/")) return "Back to folder";
  if (route.startsWith("folders/public")) return "Shared Folders";
  if (route.startsWith("folders/starred")) return "Starred";
  if (route.startsWith("folders")) return "Paper Folders";
  if (route.startsWith("community")) return "Community";
  return "All Paper";
}
export function activeSection(route: string): string {
  const page = route.split(/[/?]/)[0];
  if (page === "paper") return activeSection(returnRoute("papers", route));
  if (["folder", "read", "folders", "explore", "starred"].includes(page))
    return "folders";
  return page === "proposals" ? "community" : page;
}
export function useReturnFocus(ready: boolean) {
  const restored = useRef(false);
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const id = routeParams().get("focus");
    if (id)
      document
        .getElementById(`paper-${id}`)
        ?.scrollIntoView({ block: "start" });
  }, [ready]);
}
