import { describe, expect, it } from "vitest";
import { BJERKE } from "@/lib/tips/testdata";
import { close, linkTip, normHorse, suggestStart } from "@/lib/tips/match";

const link = (leg: number | null, number: number | null, horseName: string) => linkTip({ leg, number, horseName }, BJERKE);

describe("normHorse och close (6.11)", () => {
  it("normaliserar", () => {
    expect(normHorse("Vardø Storm")).toBe(normHorse("Vardo Storm"));
    expect(normHorse("Kaley D.C. (US)")).toBe("kaley dc");
    expect(normHorse("S.B.'sPeakyBlinder")).toBe("sbspeakyblinder");
    expect(normHorse("Tripsson Ø.K.")).toBe("tripsson ok");
  });
  it("close", () => {
    expect(close("Mellby Harly", "Mellby Harley")).toBe(true);
    expect(close("Odin", "Oden")).toBe(false);
    expect(close("Peggy Boko", "Pegasus Bok")).toBe(false);
  });
});

describe("linkTip (6.11)", () => {
  it("avd 6, nr 3, Peggy Boko: säker", () => expect(link(6, 3, "Peggy Boko")).toMatchObject({ match: "SURE", flags: [], start: { startId: "s6_3" } }));
  it("avd 3, nr 5, Mellby Harly: osäker, stavning", () => expect(link(3, 5, "Mellby Harly")).toMatchObject({ match: "UNSURE", flags: ["NAME_SPELLING"], start: { startId: "s3_5" } }));
  it("avd 3 utan nr, Mellby Harly: ej kopplad med förslaget 5 Mellby Harley", () => {
    const r = link(3, null, "Mellby Harly");
    expect(r).toMatchObject({ match: "NONE", start: null, flags: ["NO_MATCH"] });
    expect(r.suggestion?.startId).toBe("s3_5");
  });
  it("avd 3, nr 7, Mellby Harley (har nr 5): osäker, annat nummer, kopplad till nr 5", () =>
    expect(link(3, 7, "Mellby Harley")).toMatchObject({ match: "UNSURE", flags: ["NUMBER_MISMATCH"], start: { startId: "s3_5" } }));
  it("avd 2, nr 5, Mellby Harley (går i avd 3): osäker, annan avd", () =>
    expect(link(2, 5, "Mellby Harley")).toMatchObject({ match: "UNSURE", flags: ["LEG_MISMATCH"], start: { startId: "s3_5" } }));
  it("avd + nr finns men namnet finns inte: annat namn", () => expect(link(4, 1, "Okänd Häst")).toMatchObject({ match: "UNSURE", flags: ["NAME_MISMATCH"], start: { startId: "s4_1" } }));
  it("nr saknas, namnet finns i avd: nummer saknas", () => expect(link(4, null, "Baron Tilly")).toMatchObject({ match: "UNSURE", flags: ["NUMBER_MISSING"], start: { startId: "s4_1" } }));
  it("avd saknas, namnet finns en gång: avd saknas", () => expect(link(null, null, "Peacekeeper")).toMatchObject({ match: "UNSURE", flags: ["LEG_MISSING"], start: { startId: "s5_2" } }));
  it("ett namn som finns i två avdelningar och saknar avd: ej kopplad", () => expect(link(null, 4, "Dubbel Trubbel")).toMatchObject({ match: "NONE", flags: ["NO_MATCH"] }));
  it("struken häst: SCRATCHED och osäker", () => expect(link(1, 9, "Ragnar Rask")).toMatchObject({ match: "UNSURE", flags: ["SCRATCHED"] }));
  it("okänt namn utan likhet: ej kopplad utan förslag", () => expect(link(null, null, "Helt Annan")).toMatchObject({ match: "NONE", suggestion: null }));
  it("suggestStart letar i avd först, sedan i omgången", () => expect(suggestStart("Mellby Harly", 8, BJERKE)?.startId).toBe("s3_5"));
});
