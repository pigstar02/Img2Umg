#!/usr/bin/env node
import { buildPackage } from "./pipeline.js";
const [input, output, ...extra] = process.argv.slice(2);
if (!input || !output || extra.length) {
  console.error("Usage: npm run v2:extract -- <input.html> <new-output-directory>");
  process.exitCode = 1;
} else {
  try {
    const result = await buildPackage(input, output);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "passed") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
