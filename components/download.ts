// Laddar ner en text som fil via en temporär länk. Adressen släpps först en
// stund efter klicket, så att Safari hinner hämta den. Webbläsaren säger inte
// om filen sparades. Kastar om nedladdningen inte går att starta.
const REVOKE_DELAY_MS = 30_000;

export function downloadTextFile(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
