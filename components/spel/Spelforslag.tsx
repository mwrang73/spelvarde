"use client";

// S6 Spelförslag (specen S6): Trollspöt, Platsspel (S6a) och raden för V85/V75
// (S6b). I mobilen tre flikar (?flik=trollspot|plats|rad, byts med
// history.replaceState utan omladdning). På desktop två: Trollspöt i full
// bredd, eller Platsspel och raden sida vid sida. Allt läses ur omgångens cache
// och sparas optimistiskt via utkorgen.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useNow } from "@/components/hooks";
import { allRacesStarted, useRound } from "@/components/round/RoundProvider";
import { AppHeader } from "@/components/shell/AppHeader";
import { Banner, Skeleton } from "@/components/ui/board";
import { dayDate } from "@/lib/format";
import { RefreshRow } from "@/components/round/StreckOdds";
import { WandSpark } from "@/components/ui/WandSpark";
import { PlatsPanel } from "./PlatsPanel";
import { RadPanel } from "./RadPanel";
import { TrollPanel } from "./TrollPanel";

export type Tab = "trollspot" | "plats" | "rad";

const tabOf = (f: string | null): Tab => (f === "rad" ? "rad" : f === "trollspot" ? "trollspot" : "plats");

export function Spelforslag({ initialTab }: { initialTab: Tab }) {
  const { data, load, roundId } = useRound();
  const [tab, setTab] = useState<Tab>(initialTab);
  const now = useNow(30_000).getTime();
  const back = { href: `/omgang/${roundId}`, label: "Tillbaka till omgången" };

  // Bakåt/framåt i webbläsaren följer fliken.
  useEffect(() => {
    const onPop = () => setTab(tabOf(new URLSearchParams(window.location.search).get("flik")));
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
            <button type="button" className="troll-btn" aria-pressed={tab === "trollspot"} aria-controls="p-troll" onClick={() => choose("trollspot")}>
              <WandSpark />
              Trollspöt
            </button>
            <button type="button" aria-pressed={tab === "plats"} aria-controls="p-plats" onClick={() => choose("plats")}>
              Platsspel
            </button>
            <button type="button" aria-pressed={tab === "rad"} aria-controls="p-rad" onClick={() => choose("rad")}>
              {data.round.gameType}-rad
            </button>
          </div>
        </div>
        <div className="dtabs d-only" role="group" aria-label="Spelförslag">
          <button type="button" className="troll-btn" aria-pressed={tab === "trollspot"} aria-controls="p-troll" onClick={() => choose("trollspot")}>
            <WandSpark /> Trollspöt
          </button>
          <button type="button" aria-pressed={tab !== "trollspot"} aria-controls="p-plats p-rad" onClick={() => choose("plats")}>
            Platsspel och {data.round.gameType}-rad
          </button>
        </div>
        {!allRacesStarted(data.races, now) && <RefreshRow data={data} />}
        {tab === "trollspot" && (
          <section id="p-troll" className="spel-p trollp" aria-labelledby="h-troll">
            <TrollPanel data={data} now={now} />
          </section>
        )}
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
