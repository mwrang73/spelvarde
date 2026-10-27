import { APIConnectionTimeoutError, APIError, AuthenticationError, InternalServerError, RateLimitError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AI_ERR, aiErrorOf, toolInputOf, TIPS_MODEL } from "@/lib/tips/ai";

describe("AI-anropet (10.7)", () => {
  it("modellen", () => expect(TIPS_MODEL).toBe("claude-sonnet-5-5"));
  it("felmappningen", () => {
    const h = new Headers();
    expect(aiErrorOf(new APIConnectionTimeoutError({ message: "t" }))).toMatchObject({ status: 504, message: AI_ERR.timeout });
    expect(aiErrorOf(new AuthenticationError(401, {}, "nej", h))).toMatchObject({ status: 503, message: AI_ERR.badKey });
    expect(aiErrorOf(new RateLimitError(429, {}, "för många", h))).toMatchObject({ status: 502, message: AI_ERR.overloaded });
    expect(aiErrorOf(APIError.generate(529, {}, "overloaded", h))).toMatchObject({ status: 502, message: AI_ERR.overloaded });
    expect(aiErrorOf(new InternalServerError(500, {}, "fel", h))).toMatchObject({ status: 502, message: AI_ERR.other });
    expect(aiErrorOf(new Error("x"))).toMatchObject({ status: 502, message: AI_ERR.other });
  });
  it("verktygets input ur svaret", () => {
    expect(toolInputOf([{ type: "text" }, { type: "tool_use", name: "rapportera_tips", input: { tips: [] } }])).toEqual({ tips: [] });
    expect(toolInputOf([{ type: "tool_use", name: "annat", input: { tips: [] } }])).toBeNull();
    expect(toolInputOf([{ type: "tool_use", name: "rapportera_tips", input: { tips: "nej" } }])).toBeNull();
  });
});
