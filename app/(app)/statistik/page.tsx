import { AppHeader } from "@/components/shell/AppHeader";
import { EmptyState } from "@/components/ui/board";
import { IconStat } from "@/components/ui/icons";

// S9 Statistik byggs i E4. Tills dess visas specens tomma läge.
export default function StatsPage() {
  return (
    <>
      <AppHeader brand title="Statistik" sub="Statistik" />
      <main className="page" id="main">
        <EmptyState icon={<IconStat />} title="Ingen statistik än" text="Statistik visas när din första omgång är klar." />
      </main>
    </>
  );
}
