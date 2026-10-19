// Kopiera text (Kopiera rad i S6b). Clipboard-API:t kräver säker anslutning
// och tillåtelse; annars används ett dolt textfält och execCommand. false =
// det gick inte, och vyn visar texten så att den kan kopieras för hand.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Prova reserven nedan.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
