// Felorsaker vid läsning av en källa (E5 S8 Källraden). Exakta texter, visas
// efter "Kunde inte läsas: ". Ren modul.

export const FETCH_ERR = {
  timeout: "sidan svarade inte inom 10 sekunder.",
  forbidden: "sidan kräver inloggning eller nekade åtkomst (403).",
  notFound: "sidan finns inte (404).",
  status: (code: number) => `sidan svarade med fel (${code}).`,
  robots: "sidan tillåter inte automatisk läsning (robots.txt).",
  notHtml: "adressen är inte en webbsida.",
  tooLarge: "sidan är för stor (över 2 MB).",
  tooShort: "artikeln innehöll för lite text, kanske kräver den inloggning.",
  // Inte i specen: namnuppslag eller anslutning misslyckades (inte en timeout).
  unreachable: "sidan gick inte att nå.",
  // Inte i specen: omdirigering till en annan domän eller till http.
  redirect: "sidan skickade vidare till en annan webbplats.",
} as const;

export class TipFetchError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "TipFetchError";
  }
}
