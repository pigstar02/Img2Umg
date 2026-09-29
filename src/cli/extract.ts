#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractUiPackage } from "../core/extract";
import type { VisualNode } from "../core/types";
import { writeUiPackage } from "./write-package";

interface VisualInput {
  screenId: string;
  canvas: { width: number; height: number };
  root: VisualNode;
}

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  console.error("Usage: npm run extract -- <input.visual.json> <output-directory>");
  process.exitCode = 1;
} else {
  try {
    const inputPath = resolve(inputArgument);
    const outputPath = resolve(outputArgument);
    const value: unknown = JSON.parse(await readFile(inputPath, "utf8"));
    const input = validateVisualInput(value);
    const pkg = extractUiPackage(input.screenId, input.canvas, input.root, {
      onDiagnostic: ({ parentId, itemIds, status, reason }) => console.error(`[${status}] ${parentId} (${itemIds.join(", ")}): ${reason}`),
    });
    await writeUiPackage(pkg, outputPath);
    console.log(`Wrote ${1 + pkg.manifest.screens.length + pkg.manifest.entries.length + pkg.manifest.previews.length} files to ${outputPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function validateVisualInput(value: unknown): VisualInput {
  const errors: string[] = [];
  if (!isObject(value)) throw new Error("Invalid visual input:\n$: expected object");
  if (typeof value.screenId !== "string" || !value.screenId) errors.push("$.screenId: expected non-empty string");
  if (!isObject(value.canvas) || !positive(value.canvas.width) || !positive(value.canvas.height)) errors.push("$.canvas: width and height must be positive numbers");
  validateVisualNode(value.root, "$.root", errors);
  if (errors.length) throw new Error(`Invalid visual input:\n${errors.join("\n")}`);
  return value as unknown as VisualInput;
}

function validateVisualNode(value: unknown, path: string, errors: string[]) {
  if (!isObject(value)) return errors.push(`${path}: expected object`);
  if (typeof value.id !== "string" || !value.id) errors.push(`${path}.id: expected non-empty string`);
  const types = ["Canvas", "Overlay", "HorizontalBox", "VerticalBox", "WidgetSwitcher", "SizeBox", "ScaleBox", "Spacer", "Border", "Image", "Text", "Button", "ProgressBar"];
  if (typeof value.type !== "string" || !types.includes(value.type)) errors.push(`${path}.type: unsupported visual node type`);
  if (!isObject(value.bounds) || !finite(value.bounds.x) || !finite(value.bounds.y) || !positive(value.bounds.width) || !positive(value.bounds.height)) errors.push(`${path}.bounds: x/y must be finite and width/height positive`);
  if (value.collection !== undefined) {
    if (!["auto", "list", "tile", "none"].includes(String(value.collection)) || typeof value.collection !== "string") errors.push(`${path}.collection: expected auto, list, tile or none`);
    if (!["Canvas", "Overlay", "HorizontalBox", "VerticalBox", "SizeBox", "ScaleBox", "Border", "Button"].includes(String(value.type))) errors.push(`${path}.collection: only containers accept collection hints`);
  }
  if (value.props !== undefined && !isObject(value.props)) errors.push(`${path}.props: expected object`);
  if (value.children !== undefined && !Array.isArray(value.children)) errors.push(`${path}.children: expected array`);
  else if (Array.isArray(value.children)) value.children.forEach((child, index) => validateVisualNode(child, `${path}.children[${index}]`, errors));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}
