// robots.txt (E5 10.6). Enkel tolkning: User-agent, Disallow och Allow.
// Längsta matchningen vinner, och Allow vinner vid lika längd. "*" i mönstret
// matchar vad som helst och "$" sist förankrar slutet. En grupp för vår egen
// produkttoken ("Spelvärde") går före gruppen för "*". Ren modul.

type Rule = { allow: boolean; pattern: string };
type Group = { agents: string[]; rules: Rule[] };

function parse(txt: string): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") {
      // Tom Disallow = allt tillåtet (ingen regel).
      if (!value) continue;
      cur.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  return groups;
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path);
}

// Produkttoken ur User-Agent: "Spelvärde (privat bruk)" → "spelvärde".
const productToken = (ua: string) => ua.trim().split(/[\s/(]/)[0].toLowerCase();

export function isAllowed(robotsTxt: string | null | undefined, path: string, ua: string): boolean {
  if (!robotsTxt) return true;
  const groups = parse(robotsTxt);
  const token = productToken(ua);
  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && (a === token || token.startsWith(a))));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  let best: Rule | null = null;
  for (const g of chosen) {
    for (const r of g.rules) {
      if (!patternMatches(r.pattern, path)) continue;
      if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow && !best.allow)) best = r;
    }
  }
  return best ? best.allow : true;
}
