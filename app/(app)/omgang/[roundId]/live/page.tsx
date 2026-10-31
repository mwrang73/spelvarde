import { LivePage } from "@/components/live/LivePage";

// Live (E8): se loppet, tagga och visa resultat. Allt kommer ur omgångens cache
// (RoundProvider), så byte av lopp och häst gör inga anrop mot omgången.
export default function LiveRoute() {
  return <LivePage />;
}
