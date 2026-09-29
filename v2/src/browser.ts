import { chromium, type Browser, type Page } from "playwright-core";
import { access, readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, extname } from "node:path";
import { CompileError } from "./types.js";

export const ORIGIN = "https://ui.invalid";
export const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
};
export async function confinedFile(root: string, path: string): Promise<string> {
  const full = await realpath(resolve(root, path));
  const rel = relative(await realpath(root), full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Resource escapes root: ${path}`);
  return full;
}
export async function launchBrowser(): Promise<Browser> {
  const candidates = process.env.UI_BROWSER_PATH ? [process.env.UI_BROWSER_PATH] : [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
    chromium.executablePath(),
  ];
  for (const executablePath of candidates) {
    try { await access(executablePath); } catch { continue; }
    return chromium.launch({ executablePath, headless: true });
  }
  throw new CompileError([{ code: "E_BROWSER_MISSING", message: "Install Chrome/Chromium and set UI_BROWSER_PATH to its executable." }]);
}
export async function loadPage(browser: Browser, html: string, rootDirectory: string, viewport = { width: 1280, height: 720 }): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: "block" });
  const failures: string[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== ORIGIN || request.method() !== "GET") {
      failures.push(`Blocked resource ${url.href}`); await route.abort(); return;
    }
    if (url.pathname === "/index.html" && request.isNavigationRequest()) {
      await route.fulfill({ status: 200, contentType: "text/html", body: html }); return;
    }
    try {
      const path = decodeURIComponent(url.pathname).slice(1);
      const mime = MIME[extname(path).toLowerCase()];
      if (!mime || url.search) throw new Error(`Unsupported resource: ${path}`);
      const full = await confinedFile(rootDirectory, path);
      const bytes = await readFile(full);
      if (bytes.length > 20 * 1024 * 1024) throw new Error(`Resource too large: ${path}`);
      await route.fulfill({ status: 200, contentType: mime, body: bytes });
    } catch (error) {
      failures.push(String(error)); await route.abort();
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: "load", timeout: 20000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => image.decode()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    if (failures.length) throw new Error(failures.join("\n"));
    return { page, close: () => context.close() };
  } catch (error) {
    await context.close();
    throw new CompileError([{ code: "E_BROWSER_RESOURCE", message: String(error) }]);
  }
}
