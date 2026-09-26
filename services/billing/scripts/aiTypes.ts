import { readFileSync } from "node:fs";
import path from "node:path";
import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";

export const CONTRACT = path.resolve(import.meta.dirname, "../../../contracts/ai-service.openapi.json");
export const OUTPUT = path.resolve(import.meta.dirname, "../src/generated/ai-service.d.ts");

const HEADER = `/**
 * GENERATED from contracts/ai-service.openapi.json. Do not edit by hand.
 * Regenerate with \`npm run gen:ai-types\` after \`python -m ai_service.export_openapi\`.
 */

`;

/** The generated file's exact text. A test compares this with the committed file, so a stale file fails CI. */
export async function renderAiTypes(): Promise<string> {
  const spec = JSON.parse(readFileSync(CONTRACT, "utf-8")) as OpenAPI3;
  return HEADER + astToString(await openapiTS(spec));
}
