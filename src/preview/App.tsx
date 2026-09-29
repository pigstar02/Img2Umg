import packageJson from "virtual:img2umg-package";
import { useState, type ChangeEvent } from "react";
import type { UiPackage } from "../core/types";
import { validateManifest, validatePackage } from "../core/validation";
import { PackageRenderer } from "./Renderer";

const initialPackage = packageJson as unknown as UiPackage;
const initialScreenRef = initialPackage.manifest.screens[0];
const initialCanvas = initialScreenRef ? initialPackage.screens[initialScreenRef.file]?.canvas : undefined;

export default function App() {
  const [pkg, setPackage] = useState(initialPackage);
  const [packageLabel, setPackageLabel] = useState("内置示例");
  const [loadError, setLoadError] = useState("");
  const [resolution, setResolution] = useState(initialCanvas ?? { width: 1280, height: 720 });
  const validation = validatePackage(pkg);
  const screenRef = pkg.manifest.screens[0];
  const screen = screenRef ? pkg.screens[screenRef.file] : undefined;
  const resolutionKey = `${resolution.width}x${resolution.height}`;
  const presetResolution = ["1280x720", "1440x900", "1920x1080", "2560x1440"].includes(resolutionKey) ? resolutionKey : "custom";

  const openPackage = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    try {
      const loaded = await packageFromFiles(event.target.files);
      setPackage(loaded.pkg);
      setPackageLabel(loaded.label);
      setLoadError("");
      const loadedScreenRef = loaded.pkg.manifest.screens[0];
      const loadedCanvas = loadedScreenRef ? loaded.pkg.screens[loadedScreenRef.file]?.canvas : undefined;
      if (loadedCanvas) setResolution(loadedCanvas);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Img2UMG</p>
          <h1>UI package preview</h1>
          <p className="package-name">当前：{packageLabel}</p>
        </div>
        <div className="header-actions">
          <label className="open-package">
            打开 UI 包
            <input type="file" multiple {...{ webkitdirectory: "" }} onClick={(event) => { event.currentTarget.value = ""; }} onChange={openPackage} />
          </label>
          <span className={!loadError && validation.valid ? "status valid" : "status invalid"}>{loadError ? "打开失败" : validation.valid ? "Package valid" : `${validation.errors.length} errors`}</span>
        </div>
      </header>
      {validation.valid && screen && !loadError ? (
        <div className="resolution-bar">
          <span>预览分辨率</span>
          <label><span>宽</span><input aria-label="预览宽度" type="number" min="1" max="7680" value={resolution.width} onChange={(event) => setResolution((current) => ({ ...current, width: positiveInteger(event.target.value, current.width) }))} /></label>
          <span className="resolution-times">×</span>
          <label><span>高</span><input aria-label="预览高度" type="number" min="1" max="4320" value={resolution.height} onChange={(event) => setResolution((current) => ({ ...current, height: positiveInteger(event.target.value, current.height) }))} /></label>
          <select aria-label="常用分辨率" value={presetResolution} onChange={(event) => {
            const [width, height] = event.target.value.split("x").map(Number);
            if (width && height) setResolution({ width, height });
          }}>
            <option value="custom" disabled>自定义</option>
            <option value="1280x720">1280 × 720</option>
            <option value="1440x900">1440 × 900</option>
            <option value="1920x1080">1920 × 1080</option>
            <option value="2560x1440">2560 × 1440</option>
          </select>
          <button type="button" className="reset-resolution" onClick={() => setResolution(screen.canvas)}>恢复原始尺寸</button>
        </div>
      ) : null}
      {loadError ? <pre>{loadError}</pre> : validation.valid && screen ? <PackageRenderer pkg={pkg} screen={screen} viewport={resolution} /> : <pre>{validation.errors.join("\n") || "Package has no screen"}</pre>}
    </main>
  );
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

async function packageFromFiles(fileList: FileList): Promise<{ pkg: UiPackage; label: string }> {
  const files = Array.from(fileList);
  const pathOf = (file: File) => (file.webkitRelativePath || file.name).replaceAll("\\", "/");
  const fileMap = new Map(files.map((file) => [pathOf(file), file]));
  const manifestEntry = [...fileMap.entries()].find(([path]) => path.endsWith("/ui.manifest.json") || path === "ui.manifest.json");
  if (!manifestEntry) throw new Error("所选文件夹中没有 ui.manifest.json");

  const [manifestPath, manifestFile] = manifestEntry;
  const manifest = JSON.parse(await manifestFile.text()) as UiPackage["manifest"];
  const manifestValidation = validateManifest(manifest);
  if (!manifestValidation.valid) throw new Error(manifestValidation.errors.join("\n"));
  const base = manifestPath.slice(0, manifestPath.length - "ui.manifest.json".length);
  const readSection = async <T,>(refs: { file: string }[]) => {
    const values: Record<string, T> = {};
    for (const ref of refs) {
      const file = fileMap.get(`${base}${ref.file.replaceAll("\\", "/")}`);
      if (!file) throw new Error(`缺少文件：${ref.file}`);
      values[ref.file] = JSON.parse(await file.text()) as T;
    }
    return values;
  };

  const pkg: UiPackage = {
    manifest,
    screens: await readSection(manifest.screens),
    entries: await readSection(manifest.entries),
    previews: await readSection(manifest.previews),
  };
  const folderLabel = base.replace(/\/$/, "").split("/").at(-1);
  return { pkg, label: folderLabel || manifest.screens[0]?.id || manifestFile.name };
}
