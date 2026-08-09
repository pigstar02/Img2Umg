# Img2UMG

Img2UMG 用来把游戏 UI 截图、设计稿或参考图重建为可编辑的 Unreal UMG 界面。

同一份 UI 包可以同时用于：

- 在浏览器中预览和检查布局；
- 在不同分辨率下检查适配效果；
- 导入 Unreal Engine，生成可继续编辑的 Widget Blueprint。

目前只负责静态界面结构，不会从图片中推断玩法逻辑、数据绑定、按钮行为、动画、材质或自定义字体。

## 环境要求

- Node.js 20.19.x，或 Node.js 22.12 及以上版本；
- npm；
- 如需生成 UMG 资源，需要 Unreal Engine 5 和一个可编译编辑器插件的项目。

首次使用先安装依赖：

```powershell
npm install
```

## 推荐用法：从参考图重建 UI

项目内置了 [`reconstruct-img2umg-ui`](skills/reconstruct-img2umg-ui/SKILL.md) 技能。推荐把图片交给支持该技能的 Codex，让它直接分析图片并生成 UI 包，不要先把图片转换成坐标数据。

可以使用类似下面的请求：

```text
请使用 reconstruct-img2umg-ui 技能，根据我提供的图片重建界面。
输出到 examples/my-ui，并完成检查和不同分辨率预览。
图片中缺失的 Unreal 贴图先使用中性占位，不要编造资源路径。
```

建议同时提供：

- 清晰的原始图片，尽量不要经过聊天软件压缩；
- 图片对应的原始分辨率；
- 可用的 Unreal 贴图路径，例如 `/Game/UI/T_Icon.T_Icon`；
- 同一界面在不同分辨率下的截图（如果有）；
- 哪些区域需要滚动、重复生成或保持固定尺寸。

技能会识别主要区域、层级、文字和重复项目，选择合适的布局方式，生成 UI 包，然后进行格式检查和浏览器预览。

## 输入图片分辨率不一致

输入图片不需要预先统一分辨率。

- 不同图片代表不同界面时，每个界面可以使用各自的原始尺寸。
- 多张图片代表同一界面的不同分辨率时，它们会共同用于判断哪些元素贴边、居中、拉伸或保持固定大小。
- 预览页面可以切换常用分辨率，也可以输入自定义宽高。
- 如果图片存在裁切、黑边、强制拉伸或宽高比变化，请在提交图片时说明；这些情况不能只根据像素尺寸自动判断。

每个界面仍然需要一个基准画布尺寸。一般使用最清晰、信息最完整的参考图作为基准，再用其他尺寸检查适配结果。

## UI 包结构

一个完整的 UI 包如下：

```text
MyUI/
├── ui.manifest.json
├── screens/MyUI.screen.json
├── entries/Item.entry.json
└── previews/ItemPreview.preview.json
```

- `ui.manifest.json`：入口文件，记录界面、重复项目模板和预览数据的位置；
- `screens`：完整界面；
- `entries`：列表或网格中的单个重复项目；
- `previews`：重复项目在浏览器预览中的示例内容。

完整格式说明见 [`skills/reconstruct-img2umg-ui/references/format.md`](skills/reconstruct-img2umg-ui/references/format.md)。

## 检查生成结果

生成或修改 UI 包后，先运行：

```powershell
npm run validate -- examples/my-ui/ui.manifest.json
```

检查通过时会显示界面、项目模板和预览数据的数量。任何未知字段、错误尺寸、重复名称、缺失文件或无效引用都会被报告。

仓库自带示例可以这样检查：

```powershell
npm run validate -- examples/inventory/ui.manifest.json
```

## 浏览器预览

直接启动预览：

```powershell
npm run dev
```

打开终端显示的本地地址。页面默认显示仓库自带示例。点击页面右上角的“打开 UI 包”，选择包含 `ui.manifest.json` 的整个文件夹，即可查看其他 UI 包。

也可以在启动时指定一个 UI 包：

```powershell
$env:IMG2UMG_MANIFEST = "D:\Documents\Img2Umg\examples\my-ui\ui.manifest.json"
npm run dev
```

页面顶部可以：

- 切换 `1280 × 720`、`1440 × 900`、`1920 × 1080` 和 `2560 × 1440`；
- 输入自定义宽度和高度；
- 恢复 UI 包记录的原始尺寸。

检查时应重点观察文字是否溢出、内容是否被裁掉、边距是否保持、居中元素是否仍然居中，以及列表和网格是否正常排列。

## 导入 Unreal Engine

1. 把 [`unreal/Img2Umg`](unreal/Img2Umg) 文件夹复制到 Unreal 项目的 `Plugins` 目录。
2. 重新生成项目文件并编译编辑器。
3. 在 Unreal 的插件管理页面启用 **Img2Umg**。
4. 打开菜单 **Tools > Import Img2Umg UI Package...**。
5. 选择目标 UI 包的 `ui.manifest.json`。

生成的资源会保存到 `/Game/Img2Umg`，名称以 `WBP_` 开头。再次导入同名界面时，已有生成资源会被更新。

导入前应先在本项目中运行检查。遇到无效文件、不支持的内容、缺失贴图或生成失败时，Unreal 导入会停止并显示原因。

插件目前已在 Unreal Engine 5.6.1 下完成编译验证。其他 Unreal Engine 5 版本建议在正式使用前用对应版本重新编译和测试。

## 贴图和占位内容

图片重建时，参考图本身不会被自动切图或导入 Unreal。

贴图来源必须是 Unreal 中已经存在的资源路径，例如：

```text
/Game/UI/T_Icon.T_Icon
```

没有可用贴图时，应先保留空来源并使用颜色占位。不要把本地 PNG 文件路径写成 Unreal 贴图来源。浏览器里的占位说明文字也不会自动成为 Unreal 界面中的正式文字。

## 旧用法：从结构化坐标数据生成

如果已经有描述界面层级和绝对坐标的 `visual.json`，可以使用旧提取命令：

```powershell
npm run extract -- examples/input.visual.json examples/generated
```

该命令的输入不是截图，而是已经整理好的节点和坐标数据。它会尝试把三个或更多连续、结构相同、尺寸接近且间距稳定的项目识别为列表或网格。模糊、不规则或只有两个项目的情况会保留为普通元素。

对于直接从截图重建的任务，优先使用前面的技能流程，因为它能结合视觉含义判断界面层级和不同分辨率下的布局。

## 项目自检

提交修改前运行：

```powershell
npm run check
```

该命令会运行全部测试并构建浏览器预览。只有全部通过，才说明项目代码和内置示例没有明显问题。

## 当前支持的界面元素

目前支持画布、叠层、横向排列、纵向排列、固定尺寸容器、缩放容器、留白、边框、图片、文字、按钮、进度条、列表和网格。

边框默认是直角。只有参考图确实使用圆角时，才应设置圆角。列表和网格中的重复项目应单独建立模板，方便进入 Unreal 后继续编辑和复用。
