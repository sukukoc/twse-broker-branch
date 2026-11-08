import { useEffect, useState, type ReactNode } from "react";
import { DetailScreen } from "@/components/DetailScreen";
import { EventsScreen, MethodologyScreen, StatusScreen } from "@/components/OtherScreens";
import { MarketScreen } from "@/components/MarketScreen";
import { Shell } from "@/components/Shell";
import { parseHash, resolveDataUrl, type Route } from "@/lib/public-url";
import type { Snapshot } from "@/lib/types";

export function App({ initialSnapshot }: { initialSnapshot?: Snapshot }) {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initialSnapshot ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialSnapshot == null);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (initialSnapshot) return;
    const url = resolveDataUrl(window.location.href, "data/snapshot.json");
    let cancelled = false;
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as Snapshot;
        if (body.schemaVersion !== 1 || !Array.isArray(body.instruments)) throw new Error("快照格式不符");
        if (!cancelled) setSnapshot(body);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "讀取失敗");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialSnapshot]);

  let body: ReactNode;
  if (loading) body = <p className="text-sm">正在讀取已發布的快照。</p>;
  else if (!snapshot) {
    body = (
      <section className="rounded-3xl border border-line bg-card p-6">
        <h2 className="text-xl font-semibold">還沒有可顯示的資料</h2>
        <p className="mt-2 text-sm leading-6">
          快照沒有讀到{error ? `（${error}）` : ""}。請在專案目錄執行 <code>npm run update</code>。
          這個畫面不會放示範行情。
        </p>
      </section>
    );
  } else if (route.name === "events") body = <EventsScreen snapshot={snapshot} />;
  else if (route.name === "status") body = <StatusScreen snapshot={snapshot} />;
  else if (route.name === "methodology") body = <MethodologyScreen />;
  else if (route.name === "bond") body = <DetailScreen snapshot={snapshot} id={route.id} />;
  else body = <MarketScreen snapshot={snapshot} />;

  return <Shell route={route} snapshot={snapshot}>{body}</Shell>;
}
