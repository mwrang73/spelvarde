"use client";

// S6 Spelförslag (specen S6): Platsspel (S6a) och raden för V85/V75 (S6b). I mobilen
// som två flikar (?flik=plats|rad, byts med history.replaceState utan
// omladdning), på desktop sida vid sida. Allt läses ur omgångens cache och
// sparas optimistiskt via utkorgen.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useNow } from "@/components/hooks";
import { useRound } from "@/components/round/RoundProvider";
import { AppHeader } from "@/components/shell/AppHeader";
import { Banner, Skeleton } from "@/components/ui/board";
import { dayDate } from "@/lib/format";
import { PlatsPanel } from "./PlatsPanel";
import { RadPanel } from "./RadPanel";

export type Tab = "plats" | "rad";

export function Spelforslag({ initialTab }: { initialTab: Tab }) {
  const { data, load, roundId } = useRound();
  const [tab, setTab] = useState<Tab>(initialTab);
  const now = useNow(30_000).getTime();
  const back = { href: `/omgang/${roundId}`, label: "Tillbaka till omgången" };

  // Bakåt/framåt i webbläsaren följer fliken.
  useEffect(() => {
    const onPop = () => setTab(new URLSearchParams(window.location.search).get("flik") === "rad" ? "rad" : "plats");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const choose = useCallback((t: Tab) => {
    setTab(t);
    const url = `${window.location.pathname}?flik=${t}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, []);

  if (!data)
    return (
      <>
        <AppHeader title="Spelförslag" sub="Laddar …" back={back} />
        <main className="page" id="main">
          {load.error && !load.loading ? (
            <Banner tone={load.notFound ? "info" : "err"} className="m10" actions={load.notFound ? <Link href="/">Till aktuell omgång</Link> : undefined}>
              {load.notFound ? "Omgången finns inte." : load.error}
            </Banner>
          ) : (
            <div className="sk-block m10" aria-busy="true" aria-label="Laddar spelförslaget">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} width={`${90 - i * 6}%`} height={18} />
              ))}
            </div>
          )}
        </main>
      </>
    );

  return (
    <>
      <AppHeader title="Spelförslag" sub={`${data.round.gameType} · ${data.round.trackName} · ${dayDate(data.round.date)}`} back={back} />
      <main className="spel" id="main" data-tab={tab}>
        <div className="segw m-only">
          <div className="seg" role="group" aria-label="Spelförslag">
            <button type="button" aria-pressed={tab === "plats"} aria-controls="p-plats" onClick={() => choose("plats")}>
              Platsspel
            </button>
            <button type="button" aria-pressed={tab === "rad"} aria-controls="p-rad" onClick={() => choose("rad")}>
              {data.round.gameType}-rad
            </button>
          </div>
        </div>
        <div className="dcols">
          <section id="p-plats" className="spel-p plats" aria-labelledby="h-plats">
            <PlatsPanel data={data} now={now} />
          </section>
          <section id="p-rad" className="spel-p rad" aria-labelledby="h-rad">
            <RadPanel data={data} now={now} />
          </section>
        </div>
      </main>
    </>
  );
}
