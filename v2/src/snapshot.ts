import type { Rect } from "./types.js";
export interface SnapshotNode {
  id: string; tag: string; field?: string; entry?: string; collection?: string; layoutHint?: string;
  width: string; height: string; left: string; top: string; text: string; src?: string; rect: Rect;
  style: Record<string, string>; children: SnapshotNode[];
}
export interface Snapshot { root: SnapshotNode; fonts: { family: string; weight: string; src: string; loaded: boolean }[] }

/** Runs exclusively inside the isolated browser; no module-scope dependencies. */
export function snapshotPage(): Snapshot {
  const rules = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules));
  const styleRules = rules.filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
  const readSize = (el: HTMLElement, property: string): string => {
    let winner = "auto";
    let best = [-1, -1, -1];
    for (const rule of styleRules) {
      const value = rule.style.getPropertyValue(property);
      if (!value) continue;
      for (const selector of rule.selectorText.split(",")) {
        if (!el.matches(selector)) continue;
        // Source checker restricts selectors to tags, ids, classes, descendant and child combinators.
        const score = [selector.match(/#[\w-]+/g)?.length ?? 0,
          selector.match(/\.[\w-]+/g)?.length ?? 0,
          selector.replace(/[#.][\w-]+/g, "").match(/[a-zA-Z][\w-]*/g)?.length ?? 0];
        const firstDifference = score.findIndex((value, index) => value !== best[index]);
        if (firstDifference === -1 || score[firstDifference] > best[firstDifference]) { best = score; winner = value.trim(); }
      }
    }
    return el.style.getPropertyValue(property).trim() || winner;
  };
  const properties = ["display", "position", "left", "top", "z-index", "padding-left", "padding-top", "padding-right", "padding-bottom", "margin-left", "margin-top", "margin-right", "margin-bottom", "row-gap", "column-gap", "flex-direction", "align-items", "align-self", "background-color", "color", "font-family", "font-size", "font-weight", "text-align", "visibility", "overflow-x", "overflow-y"];
  const visit = (el: HTMLElement): SnapshotNode => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      id: el.dataset.uiId!, tag: el.tagName.toLowerCase(), field: el.dataset.uiField,
      entry: el.dataset.uiEntry, collection: el.dataset.uiCollection, layoutHint: el.dataset.uiLayout,
      width: readSize(el, "width"), height: readSize(el, "height"), left: readSize(el, "left"), top: readSize(el, "top"),
      text: Array.from(el.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(""),
      src: el instanceof HTMLImageElement ? el.getAttribute("src") ?? undefined : undefined,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      style: Object.fromEntries(properties.map((key) => [key, style.getPropertyValue(key)])),
      children: Array.from(el.children).map((child) => visit(child as HTMLElement)),
    };
  };
  const fonts = rules.filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule).map((rule) => {
    const family = rule.style.getPropertyValue("font-family").trim().replace(/^["']|["']$/g, "");
    const normalizeWeight = (value: string) => !value || value === "normal" ? "400" : value === "bold" ? "700" : value;
    const weight = normalizeWeight(rule.style.getPropertyValue("font-weight").trim());
    const src = rule.style.getPropertyValue("src").match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1] ?? "";
    const faces = Array.from(document.fonts).filter((face) => face.family.replace(/^["']|["']$/g, "") === family && normalizeWeight(face.weight) === weight);
    return { family, weight, src, loaded: faces.some((face) => face.status === "loaded") };
  });
  return { root: visit(document.querySelector("[data-ui-root]") as HTMLElement), fonts };
}
