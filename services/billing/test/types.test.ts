import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUTPUT, renderAiTypes } from "../scripts/aiTypes.js";

const unix = (text: string) => text.replace(/\r\n/g, "\n"); // a Windows checkout may have converted line endings

describe("generated AI-service types", () => {
  it("match contracts/ai-service.openapi.json (run `npm run gen:ai-types` if this fails)", async () => {
    expect(unix(readFileSync(OUTPUT, "utf-8"))).toBe(unix(await renderAiTypes()));
  });
});
