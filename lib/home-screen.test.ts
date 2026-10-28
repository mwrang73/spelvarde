import { describe, expect, it } from "vitest";
import { actionFor, detectPlatform } from "@/lib/home-screen";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const IPHONE_FB = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS]";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const MAC = IPAD;

describe("Lägg på hemskärmen", () => {
  it("känner igen plattformen", () => {
    expect(detectPlatform(IPHONE_SAFARI, 5)).toBe("ios-safari");
    expect(detectPlatform(IPHONE_CHROME, 5)).toBe("ios-chrome");
    expect(detectPlatform(IPHONE_FB, 5)).toBe("ios-other");
    expect(detectPlatform(IPAD, 5)).toBe("ios-safari");
    expect(detectPlatform(ANDROID, 5)).toBe("android");
    expect(detectPlatform(MAC, 0)).toBe("none");
  });
  it("väljer handling", () => {
    expect(actionFor("android", true)).toBe("prompt");
    expect(actionFor("android", false)).toBe("android-guide");
    expect(actionFor("ios-safari", false)).toBe("ios-guide");
    expect(actionFor("ios-chrome", false)).toBe("chrome-guide");
    expect(actionFor("ios-other", false)).toBe("open-in-safari");
    expect(actionFor("none", false)).toBe("none");
  });
});
