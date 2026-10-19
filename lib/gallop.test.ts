import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseStartDetail } from "@/lib/atg";
import { formAriaLabel, formBox, formBoxes, formSummary, gallopFlag, gallopWarning, lastStarts, type FormRecord } from "@/lib/gallop";

const rec = (date: string, place: number | null, galloped = false, disqualified = false, trackName = "Åby", scratched = false): FormRecord => ({ date, trackName, place, galloped, disqualified, scratched });

describe("gallop och formrutor (6.2)", () => {
  it("tar de 5 senaste riktiga starterna före omgångens datum, nyast först", () => {
    const records = [rec("2026-10-24", 1), rec("2026-10-01", 2), rec("2026-09-20", 3, false, false, "Åby", true), rec("2026-09-13", 0, true), rec("2026-08-01", 1), rec("2026-07-01", 4), rec("2026-06-01", 5), rec("2026-05-01", 6)];
    expect(lastStarts(records, "2026-10-24").map((r) => r.date)).toEqual(["2026-10-01", "2026-09-13", "2026-08-01", "2026-07-01", "2026-06-01"]);
  });
  it("G vid galopp, GD när galoppen gav diskning", () => {
    expect(gallopFlag([rec("2026-10-01", 1), rec("2026-09-01", 0, true)])).toBe("G");
    expect(gallopFlag([rec("2026-10-01", 0, true), rec("2026-09-01", null, true, true)])).toBe("GD");
    expect(gallopFlag([rec("2026-10-01", null, false, true)])).toBeNull();
    expect(gallopFlag([])).toBeNull();
  });
  it("formrutor: siffra, 0, d och g med rätt ton", () => {
    expect(formBox(rec("x", 1))).toEqual({ char: "1", tone: "win", label: "1:a" });
    expect(formBox(rec("x", 2))).toEqual({ char: "2", tone: "second", label: "2:a" });
    expect(formBox(rec("x", 4))).toEqual({ char: "4", tone: "plain", label: "4:a" });
    expect(formBox(rec("x", 0))).toEqual({ char: "0", tone: "plain", label: "oplacerad" });
    expect(formBox(rec("x", null))).toMatchObject({ char: "0" });
    expect(formBox(rec("x", 12))).toMatchObject({ char: "0" });
    expect(formBox(rec("x", null, false, true))).toEqual({ char: "d", tone: "plain", label: "diskad" });
    expect(formBox(rec("x", 0, true))).toEqual({ char: "g", tone: "gal", label: "galopp oplacerad" });
    expect(formBox(rec("x", 1, true))).toEqual({ char: "1", tone: "gal", label: "galopp 1:a" });
    expect(formBox(rec("x", null, true, true))).toEqual({ char: "d", tone: "gal", label: "galopp diskad" });
  });
  it("skärmläsartext enligt specen", () => {
    const boxes = formBoxes([rec("5", 1), rec("4", 0, true), rec("3", 2), rec("2", 1), rec("1", 0)]);
    expect(formAriaLabel(boxes)).toBe("Form, senaste först: 1:a, galopp oplacerad, 2:a, 1:a, oplacerad");
  });
  it("galoppvarningens text", () => {
    expect(gallopWarning([rec("2026-10-01", 1), rec("2026-09-13", 0, true, false, "Åby"), rec("2026-08-01", 2)])!.text).toBe("Galopp i 1 av 3 senaste starterna, 13 sep på Åby");
    expect(gallopWarning([rec("2026-10-01", 1), rec("2026-09-13", null, true, true, "Åby")])!.text).toBe("Galopp med diskning 13 sep på Åby");
    expect(gallopWarning([rec("2026-10-01", 1)])).toBeNull();
  });
  it("debutant och färre än 5 starter", () => {
    expect(formSummary([], "2026-10-24")).toMatchObject({ debut: true, fewStarts: true, boxes: [], gallop: null });
    expect(formSummary([rec("2026-10-01", 1), rec("2026-09-01", 2)], "2026-10-24")).toMatchObject({ debut: false, fewStarts: true });
  });
  it("mot fixturen start-2026-10-24_7_11-1 (5 senaste före 24/10)", () => {
    const d = parseStartDetail(JSON.parse(readFileSync(path.join(__dirname, "..", "test", "fixtures", "atg", "start-2026-10-24_7_11-1.json"), "utf8")))!;
    const s = formSummary(d.records, "2026-10-24");
    expect(s.fewStarts).toBe(false);
    expect(s.boxes.map((b) => b.char).join("")).toBe(d.records.filter((r) => !r.scratched).slice(0, 5).map((r) => formBox(r).char).join(""));
    expect(s.boxes[0]).toMatchObject({ char: "7", tone: "plain" });
    expect(s.boxes[1]).toMatchObject({ char: "2" });
  });
});
