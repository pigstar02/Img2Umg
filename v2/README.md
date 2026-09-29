# Img2UMG v2 — HTML/CSS → Semantic IR → Web

模型写 HTML/CSS，工具验证后生成可复用列表模板和统一 IR，再重建网页并自动比较。现有 [Unreal 插件](../unreal/Img2Umg/README.md)已新增独立 V2 IR 导入器和 Runtime 模块源码，保留 V1 入口。**尚未执行本次插件的 UE 编译或渲染验证。** IR 的 target 为 UE 5.8.2；V2 IR 不能交给 V1 manifest 导入入口。

## 快速运行

仓库根目录执行，建议 Node.js 22+：

```bash
npm install
npm run v2:typecheck
npm run v2:test
npm run v2:extract -- v2/examples/quests/index.html v2/output-quests
```

输出目录必须是**不存在的新目录**，其父目录须已存在，防止覆盖源文件或上一份产物。编译失败退出码为 1；对照不一致时保留产物供检查并返回 1。

需要本机 Chrome/Chromium。程序自动检查 macOS Google Chrome 与常见 Linux 安装路径，也会检查 Playwright 的 Chromium 路径。不会自动下载浏览器；自定义位置使用：

```bash
UI_BROWSER_PATH="/path/to/chrome" npm run v2:extract -- input.html output-new
```

浏览器测试也要求 Chrome；缺少浏览器会明确失败而非静默跳过。只运行无需浏览器的检查：

```bash
npx vitest run v2/tests/source.test.ts v2/tests/validate.test.ts v2/tests/render.test.ts
```

## 输出

```text
output-new/
  ui.ir.json          严格 schema 校验后的语义 IR
  preview.html        只从 IR 重建，不复用作者 CSS
  assets/             按内容 hash 命名的图片和字体
  source.png          作者网页截图（包含工具 reset）
  reconstructed.png   IR 重建网页截图
  report.json         浏览器版本、节点误差、图片哈希、集合摘要
```

可直接用浏览器打开输出的 preview.html；无需启动开发服务器，不会改变当前 DSH GUI。

报告的 `passed` 同时要求：IR 有效、所有实际节点几何差异不超过 0.5 logical px、同一浏览器中两张 PNG 字节相同。图片检查较严格，不是带容差的视觉相似度算法；因字体/平台改变导致不同也会报告 needs-revision。`ueVerification` 始终是 `not-run`。

## 首个任务列表样例

输入 [任务页](examples/quests/index.html) 与 [CSS](examples/quests/style.css)：800×600，2 张任务卡片共享模板，3 个固定操作按钮不生成集合。每个条目包含图片、标题和描述，条目文本差异进入 overrides。

此版本依赖显式意图，不自动根据“出现三次”生成列表：

```html
<div data-ui-id="Tasks" data-ui-collection="list" class="list">
  <div data-ui-id="TaskA" data-ui-entry="TaskCard" class="card">
    <span data-ui-id="TaskATitle" data-ui-field="title">Task A</span>
  </div>
  <div data-ui-id="TaskB" data-ui-entry="TaskCard" class="card">
    <span data-ui-id="TaskBTitle" data-ui-field="title">Task B</span>
  </div>
</div>
```

列表需 flex row/column、条目明确 px 宽高、同构同字段；文字、图片和颜色可变，其余布局/字体设置必须一致。一个可见条目也可声明列表；空列表和嵌套列表暂不支持。未标注或 `none` 始终保留普通容器。所有叶子文字和图片的 field 在单条模板中唯一。

## 当前实现子集（小于完整设计提案）

| 项目 | 当前支持 |
|---|---|
| 容器 | div/section/article/header/footer/nav/ul/ol/li；显式 flex row/column，nowrap |
| 文本 | span/p/h1–h6 纯文本叶；单行；本地字体映射、字号、400/700字重、左右/居中对齐 |
| 图片 | 本地 PNG/JPEG，显式宽高，object-fit:fill |
| 按钮 | button，内部一个内容容器或文字 span；不推断业务交互 |
| 尺寸 | 正 px / 受上下文约束的 auto；flex:0 0 auto；border-box |
| 间距 | 非负 px padding/margin/gap；只允许 flex 子项 margin |
| 自由定位 | 显式 data-ui-layout=canvas；直接 absolute 子项，left/top/width/height px |
| 外观 | 单色背景、文字颜色、透明背景；overflow:clip/visible；hidden/none |
| 列表 | data-ui-collection=list；模板+字段覆盖；无隐式自动列表推断 |
| 资源 | 本地 @font-face 和图片；资源必须位于 HTML 根目录树中 |
| 选择器 | 简单 ASCII tag/class/id 组合、后代及 >；无伪类/伪元素、无 CSS escape |

**尚不支持，报错而非静默降级：** Grid/TileView、Overlay、权重 Fill、百分比/响应式单位、calc/var、滚动、相对定位偏移、复杂 min/max、阴影/边框/圆角、变换、动画、多行与任意行高、图文混排、动态状态。

上下文约束：
- 唯一 `data-ui-root` 为 body 唯一直接元素，明确 px 画布宽高（各不超过 8192）。
- 每个导出元素有唯一 `data-ui-id`；容器内文字用单独 span/p，不创建匿名文本盒。
- text/image 叶子采用 block，不支持 flex 叶子中的匿名文字盒。可信 reset 将默认 span 转为 block。
- Canvas 无 padding/margin，其子项必须绝对定位；不从截图猜锚点。
- 固定交叉轴子项不能大于父可用空间；居中与不对称外边距组合先拒绝。
- hidden 父项下不能让子项恢复 visible。静态 collapsed 节点保留在 IR 和观测表（零尺寸）。
- 文本使用声明的本地 @font-face，不接受仅系统字体。当前检查字体加载与 family/weight 映射；**尚未逐字验证字体是否覆盖全部字形**，因此缺字 fallback、中文字体和 UE 文本度量仍需另行验证。
- 标签默认样式由共用 reset 清理；作者 CSS 自己也应明确布局，不能依赖默认 h1 粗体和浏览器按钮外观。

## 模块与契约

- [source.ts](src/source.ts)：parse5 + css-tree 静态语法/白名单校验；检查包括未命中的非法 CSS；内联本地 stylesheet、规范化资源 URL。
- [browser.ts](src/browser.ts)：无本地 HTTP server，用 Playwright 路由提供受限虚拟源；禁止外部网络、service worker，所有资源再次 realpath 检查。
- [snapshot.ts](src/snapshot.ts)：计算样式和 DOM 实测；额外解析受限级联保留 auto，不能把浏览器最终宽高当成所有布局意图。
- [compile.ts](src/compile.ts)：上下文能力检查、模板归一化、资源打包与语义 IR。
- [types.ts](src/types.ts) / [schema](schema/ui.schema.json) / [validate.ts](src/validate.ts)：类型、严格 JSON Schema 与跨引用/ID/字段/资源语义校验。
- [render.ts](src/render.ts)：只读取 IR 的独立规范网页渲染器，安全转义 HTML/CSS。
- [pipeline.ts](src/pipeline.ts)：对照、截图与报告；[cli.ts](src/cli.ts) 提供命令入口。

IR 中保留：节点 kind/layout/box/paint、text、资源表、字体表、templates、collections，以及只用于验证的 observations。collection view 无普通 children；items 的 nodeIds 将模板节点映射回原节点 ID，overrides 仅保存文本/图片/颜色差异。模板节点 ID 是模板命名空间，与实例 ID 分开。

JSON Schema version=2 不与旧插件包格式兼容。使用 **Tools > Import Img2Umg V2 IR...** 读取生成的 IR，旧版导入命令不要读取它。插件采用更严格的 stock UMG 子集，预检不通过会明确报错，不保证所有 Web 合法输入都可导入。

### UE 导入起步样例

[无字体样例](examples/ue-smoke/index.html)包含 Canvas、两条列表记录、背景色覆盖和普通按钮，不依赖字体资源：

```bash
npm run v2:extract -- v2/examples/ue-smoke/index.html v2/output-ue-smoke
```

仍需新输出目录。生成后在 UE 的 V2 菜单选择输出 IR。生成的 Screen 蓝图在实际 widget 初始化时填充样例；Designer 只看模板，不保证显示每条记录差异。

原任务页使用 WOFF2，仅可直接用于 Web 链路。当前 UE 字体工厂不接受 WOFF/WOFF2；请使用有授权的 TTF/OTF 更新源 CSS 并重新导出（不要只修改 IR 扩展名或哈希）。文本 native 字号为 CSS px × 0.75，基线和字形度量仍须 UE 验证。

## 安全与验证边界

- 禁止 script、on*、iframe、SVG/Canvas、作者事件、远端字体/图片、@import 等；页面测量脚本由工具注入，与作者内容分离。
- 源文件和所有资源校验目录边界及符号链接；浏览器层仅服务允许的本地图像/字体，单资源上限20MiB。
- 不支持的属性、值或上下文报明确错误；成功导出不是“自动忽略不支持项”。
- 本工具不是承诺可承受任意恶意大文件的完整多租户沙箱；不要将 CLI 无限制公开为上传服务。作者文件大小/节点数的全面配额及抗资源耗尽仍待完善。
- 测试覆盖：HTML/CSS安全与正反例、严格IR引用、渲染转义、实际浏览器提取、集合/非集合、尺寸不一致、字体缺失、坏图、布局对照。
- 安全审计发现现有 Vitest 4.1.10 测试工具链有2个 moderate 项（同一 mocker 路径遍历公告，npm 当次报告 fixAvailable=false）；未启动 Vitest 浏览器/网络服务，也未做强制升级。发布前应更新到有补丁的测试版本并复测。

## 样例资源许可

字体来自 npm `@fontsource/roboto` 的 latin 400 normal WOFF2，复制在 [DemoFont.woff2](examples/quests/assets/DemoFont.woff2)，许可见 [FONT-LICENSE.txt](examples/quests/assets/FONT-LICENSE.txt)。图标 [quest.png](examples/quests/assets/quest.png) 为本项目生成的简单像素图。对外分发打包字体时请一并携带原许可；通用打包器不会自动替用户判断资源授权。

## 后续

下一步在可构建的 UE 5.8.2 环境执行 UHT/C++ 编译、Automation 测试、蓝图导入/重开/打包与实际 widget 截图比对。TileView 间距、字体基线、设计器样例数据必须按源码报告单独适配，不能直接套用 Web 属性。完整目标参见 [重构设计](../docs/html-umg-v2-design.md) 与 [源码核对](../docs/ue-5.8-source-mapping.md)。
