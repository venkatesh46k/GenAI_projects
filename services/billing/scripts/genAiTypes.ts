import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OUTPUT, renderAiTypes } from "./aiTypes.js";

mkdirSync(path.dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, await renderAiTypes(), "utf-8");
console.log(`wrote ${OUTPUT}`);
