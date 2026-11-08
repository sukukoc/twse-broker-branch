/** Resolve a file next to the static app, including a GitHub Pages subdirectory. */
export function resolveDataUrl(pageHref: string, relativeFile: string): string {
  const url = new URL(pageHref);
  url.hash = "";
  url.search = "";
  let path = url.pathname;
  if (path.endsWith(".html")) path = path.slice(0, path.lastIndexOf("/") + 1);
  else if (!path.endsWith("/")) path += "/";
  const file = relativeFile.replace(/^\.\//, "").replace(/^\//, "");
  url.pathname = `${path}${file}`;
  return url.href;
}

export type Route =
  | { name: "market" }
  | { name: "events" }
  | { name: "status" }
  | { name: "methodology" }
  | { name: "bond"; id: string };

export function parseHash(hash: string): Route {
  const cleaned = hash.replace(/^#/, "").replace(/^\/+/, "");
  const [head, ...rest] = cleaned.split("/").filter(Boolean);
  if (!head) return { name: "market" };
  if (head === "events") return { name: "events" };
  if (head === "status") return { name: "status" };
  if (head === "methodology") return { name: "methodology" };
  if (head === "bond" && rest[0]) return { name: "bond", id: decodeURIComponent(rest[0]) };
  return { name: "market" };
}
