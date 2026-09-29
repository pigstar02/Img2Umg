# HTML → Native UMG v2：映射研究与首版语言规范

状态：设计提案，非已实现功能；不依赖现有 VisualNode 格式。官方资料核对完成的结论与待引擎验证的假设分开记录。用户已确认目标为 UE 5.8，并允许添加插件。5.5 文档仅作为历史研究材料；所有实现 API 必须在 5.8 文档/源码及编译中复核，不能混用成兼容性承诺。

## 1. 架构决策

模型创作 HTML/CSS，编译器生成机器格式；最终目标是可编辑原生 UMG，不是 WebBrowser 嵌网页，也不是整屏截图。

```text
截图 + 用户集合意图
  → 受约束 HTML/CSS + assets
  → 源码语法/属性审查
  → 隔离 Chromium 渲染（固定 viewport、字体、DPR、禁用作者脚本）
  → DOM + 声明来源 + computed style + measured geometry
  → Semantic UI IR（布局、尺寸、集合、资源、文本）
  → 验证/标准化
  ├─→ Canonical Web renderer
  └─→ UMG lowering → Widget Blueprint + Entry Blueprint + item data
```

原网页与 IR 重建网页需要对照；之后还要与真正的 UE 渲染对照。浏览器对照不能代替 UE 验证。

HTML/CSS 是唯一创作源；IR 是编译产物，不要求模型手写。不支持修改 UMG 后自动回写 HTML。

## 2. 调研所得的关键边界

| 事实/风险 | 对设计的影响 | 证据 |
|---|---|---|
| UMG HorizontalBoxSlot 暴露 Size、Padding、两轴对齐；Size 是主轴空间分配 | 不能只翻译控件属性，必须建立父级 Slot 模型 | E1 |
| CanvasSlot Offsets 随锚点变为位置/尺寸或边缘距离 | 首版固定锚点 (0,0)，不能一律把 right/bottom 当 width/height | E2 |
| SizeBox WidthOverride 改变 desired width | 固定尺寸要同时控制父 Slot 的 Auto/Fill 与对齐；不能只加 SizeBox | E3 |
| ListView 分离 UObject item 与可复用 entry，并要求 entry 接口 | 必须生成数据适配层，不能把所有 HTML 条目直接塞成 ListView 子节点 | E4 |
| TileView 条目统一尺寸 | 可变尺寸/跨格网格不能直接转换为 TileView | E5 |
| ScrollBox 不提供虚拟化 | 滚动意图与集合/虚拟化意图分开建模 | E6 |
| UniformGridPanel 与 GridPanel 是静态布局面板 | display:grid 不能自动推出 TileView | E7 |
| ScaleBox 可以按比例适配或填满 | object-fit 可通过组合控件实现，但需处理裁剪、固有尺寸和对齐 | E8 |
| 字体受 Font Resolution 和 DPI/缩放共同影响 | 锁定工程字体设置，字体转换通过样张校准，拒绝盲抄数值 | E9 |
| Slate clipping 与 CSS overflow 不是同一整套机制 | 首版只开放明确矩形裁剪；按轴裁剪、圆角遮罩另验 | E10 |

结论：目标不是 HTML 标签与 UMG Widget 数量一一对应，而是每个支持的语义有明确、可测试的编译规则。一个 div 可编译为 SizeBox + Border + HorizontalBox。

## 3. 版本与支持级别

- **C（core）**：建议纳入首版契约；实现仍必须通过双端夹具测试才称支持。
- **G（gated）**：有可行映射，但先做专门 UE 验证；未通过前编译器报错。
- **X（excluded）**：首版明确拒绝，不静默忽略，不自动栅格化。
- “文档证实 API 存在”不等于“本项目已实现/精确等价”。目前所有运行兼容性测试均未执行。

首个 target profile 锁定 UE 5.8；具体 patch/build 与 Chromium 版本在实验环境中记录。工程已有插件只作参考，不构成新规范限制。DPI/字体配置应纳入 target profile，不自动改用户项目设置。

### 已确认的插件边界

- Editor 模块：验证编译包、导入资源、生成/更新 Widget Blueprint 与 Entry Blueprint、提供诊断及验证入口。
- Runtime 模块：通用 UObject 条目数据、Entry 字段赋值与复用刷新；不得依赖 UnrealEd。使用这些基类的生成资产在打包时需要该模块。
- HTML/CSS 编译与浏览器测量在离线工具执行；游戏运行时不嵌入浏览器，也不解析 HTML/CSS。
- 每个页面无需手写 C++；产物仍是可编辑的原生控件树。若将来需要去掉 Runtime 依赖，须另行实现纯 Blueprint 适配方案，不承诺可直接移除插件。
- 第一关先做布局和列表数据对照夹具，不先重写完整导入器。旧工程保留，不覆盖原生成资产。
- 用户已提供 `/Users/pigstar/Documents/UnrealEngine-5.8`，Build.version 确认为 5.8.2。本轮按用户要求不编译插件、不运行引擎，仅核对源码；C++ 插件最终使用时仍需构建或对应版本预编译二进制。
- 源码证据与修订结论见 [UE 5.8.2 源码核对](ue-5.8-source-mapping.md)。该文档优先于早期网页资料推测；源码推导不是运行验收通过。

## 4. HTML 创作子集

### 4.1 允许的节点

C：div、section、article、header、footer、nav（布局容器）；span、p、h1–h6（纯文本叶）；img；button；ul/ol/li（去除浏览器 marker 和默认样式）。

- 根元素必须声明 `data-ui-root`，有明确 px 设计宽高。
- 所有导出元素有唯一 `data-ui-id`。模板中对应字段用 `data-ui-field`，不依赖随机 DOM id 对齐。
- 容器只能包含元素子节点和可忽略的空白；文本叶不能混入其他元素。富文本/匿名文本盒先拒绝。
- button 只包含纯文本或一个内容容器，内容容器可以有多项；禁止嵌套 button。
- ul/ol 并不自动成为虚拟化列表；必须根据显式语义处理。
- 不允许作者 JS、事件处理属性、iframe、canvas、内联 SVG、外部网络资源、Shadow DOM、表单控件；交互不属于首版截图还原目标。
- SVG 图标可先经独立、可审查的资源管线导出 PNG；不冒充可编辑向量控件。

### 4.2 少量语义属性

| 属性 | 值/用途 |
|---|---|
| data-ui-id | 源映射与诊断的唯一节点 ID |
| data-ui-layout | canvas / overlay；其余横排竖排从受支持 CSS 推导 |
| data-ui-collection | none / list / tile；缺省 none，取消旧自动提取的隐式转换 |
| data-ui-entry | 条目的模板名，同组必须一致 |
| data-ui-field | 模板内部稳定字段名，用于提取视觉差异 |
| data-ui-scroll | x / y；G，需与 overflow 和限定视口一致 |

编译器可以提示“疑似重复集合”，但不擅自将固定控件改成 ListView。静态重复仍可后续支持组件复用，与虚拟化是独立概念。

## 5. CSS 白名单（属性 + 值 + 使用上下文）

共同约定：LTR、水平书写；逻辑单位为 CSS px。首个验证 profile 设置浏览器缩放 100%、DPR=1、UE 比较界面 DPI scale=1；不把这些测试约定当作生产环境永远成立的事实。颜色按 sRGB 输入，在 UE 端正确转换到所需颜色表示，不简单把 0–255 除以 255 当线性 RGB。

| 类别 | C：首版支持范围 | G / X |
|---|---|---|
| 样式来源 | 本地 CSS、style；类、ID、标签、后代/子代选择器；普通级联/继承由浏览器解析 | X：@import、媒体/容器查询、运行时伪类、伪元素、动画、transition |
| 盒模型 | box-sizing:border-box；非负 px padding/margin；margin 仅用于 flex 子节点，避免折叠 | X：auto/负 margin、块格式化流、浮动、clear |
| 尺寸 | 正 px width/height；auto 仅用于已定义的内容尺寸情形；图片须显式宽高 | G：min/max、百分比、aspect-ratio；X：vw/vh、em/rem 尺寸、calc/min/max/clamp |
| Flex 容器 | display:flex；row/column；nowrap；justify-content:flex-start；align-items:start/end/center/stretch 对应的 flex 值 | G：主轴 center/end/space-between 的组合展开；X：wrap、reverse、baseline、order、space-around/evenly |
| Flex 子节点 | 显式 flex:0 0 auto；align-self:auto/flex-start/flex-end/center/stretch | G：权重填充 flex:n 0 0px；X：其余 flex shrink/basis 组合 |
| 间距 | gap/row-gap/column-gap 的非负 px，按布局使用对应轴 | X：百分比 gap；不能对末项额外加入尾部间距 |
| 自由定位 | data-ui-layout=canvas + position:relative；直接子节点 absolute + left/top/width/height px | G：right/bottom 与 anchor stretch；X：fixed/sticky、定位祖先跳层 |
| 叠放 | G：显式 overlay，固定尺寸、受控单格 CSS grid 叠放规则 | X：任意 stacking context、混合 z-index；C 仅 Canvas 同父兄弟的整数 z-index |
| 网格 | C：固定等宽列 repeat(N,Wpx) + 固定 grid-auto-rows:Hpx + px gap，默认行优先、无跨格 | G：等比分栏；X：任意 fr/minmax/auto-fit/auto-fill、span、dense、subgrid |
| 背景 | 单一 background-color，透明色 | G：统一圆角/边框；X：渐变、背景多层、box-shadow/filter/backdrop-filter/blend |
| 文本 | 指定本地 font-family/face；font-size:px；color；text-align:left/center/right；nowrap；纯文本 | G：多行 wrap、line-height、ellipsis、letter-spacing；X：justify、任意行内富文本、合成字体效果 |
| 图片 | PNG/JPEG + 明确尺寸；object-fit:fill | G：contain/cover + object-position:center；X：任意 UV/背景切片 |
| 可见性 | display:none；visibility:visible/hidden，hidden 子树不得重新覆盖为 visible | G：opacity 仅叶节点；X：任意子树透明合成等价承诺 |
| 溢出 | overflow:visible/clip，两轴相同；overflow-clip-margin:0；clip 为矩形裁剪 | G：显式单轴滚动；X：hidden/auto/scroll、混合轴裁剪、圆角 clip-path、mask |

注意：CSS 的 auto 在不同布局下并非统一的 UMG Auto。首版只接受能由上下文确定含义的组合；例如文本固有尺寸、非伸展 flex 子节点内容尺寸。不能支持一个 auto 就推断支持所有 shrink-to-fit/百分比循环。

Reset 由工具提供且参与预览：清除 body/heading/p/button/list 默认 margin/padding/border/marker；统一 box-sizing；为 flex 子节点提供显式 flex 规则及 min-width:0/min-height:0（这两个零值是尺寸白名单的特许，其他 min/max 门控）；文本 font/line-height profile 显式固定。未声明的默认行为必须由规范明确，不能依赖不同浏览器默认样式。

CSS 自定义属性可后续作为编译期常量开放；首版暂不开放，避免不支持的特性藏在 var 中。源码审查应看作者声明，不因为 computed style 恰好变成 px 就接受百分比/媒体查询等语义。

## 6. 确定性 UMG lowering 规则

### 6.1 横排、竖排与 Slot

- row → HorizontalBox；column → VerticalBox。
- Auto 子项 → FSlateChildSize Auto；固定主轴尺寸由 SizeBox 及父 Slot 一起限定。
- 交叉轴 start/center/end/fill → 对应 Slot 对齐。若子项交叉轴显式定宽高，CSS stretch 不应强行拉伸；编译器要分辨 definite size。
- 兄弟 gap → 按实际参与布局的子项序列分配 Slot Padding；Collapsed 排除、Hidden 保留，不对最后参与布局的子项增加尾距。首版静态状态在编译时归一化，动态显隐另需刷新。margin 与 gap 不能重复计入。
- 容器 padding → 内容包装层；子项 margin → 父 Slot 外围间距。字段统一 `{left,top,right,bottom}`，防止 CSS TRBL 与 FMargin LTRB 顺序混淆。
- WidthOverride/HeightOverride 不是不受父级约束的最终尺寸。5.8.2 AlignChild 默认夹到父级空间：交叉轴固定子项大于父可用空间的组合首版报错，不能假装实现 CSS overflow。
- 居中且该轴 margin/padding 不对称的直接 Slot 映射先拒绝；需包装层归一化后再开放。其余对齐仍按父级 Slot 处理。[E1,E3；本地源码核对 §2]

### 6.2 Flex Fill（G）

CSS 默认 flex-shrink 与自动最小尺寸不等价于 Slate 的 Auto/Fill。候选受限模式：主轴尺寸已确定的父容器；子项 flex:n 0 0px（n 为正整数）；min-width/min-height:0；无额外 min/max 钳制；Fill 外壳主轴 padding/border 为 0、margin 为 0，装饰放入内层；剩余空间非负。拒绝 flex:1 的简写，以免 0%/0px 与 shrink 默认值带来歧义。

对 padding/border 的空间扣除尤其要验证：CSS 按内容基准分配剩余空间，UMG slot Fill 按其分配规则工作，外层装饰必须归一化，不能仅 SetSize(Fill,n) 就宣布等价。测试未过前拒绝该模式。[W1,E1]

### 6.3 Canvas

直接父节点就是 containing block；Canvas 容器首版无 padding/border，外观另包。子节点 anchors=(0,0)，alignment=(0,0)，position=(left,top)，size=(width,height)。保持浮点数，最终渲染时再处理像素舍入。

不从截图坐标反推响应式锚点；百分比/right/bottom 的扩展必须显式定义锚点公式和父级尺寸变化测试。[E2,W4]

### 6.4 静态网格与 TileView

- 无集合声明的固定轨道网格 → VerticalBox + HorizontalBox + SizeBox 行/列组合，显式保留列数、gap 与末行空轨道；不默认用 UniformGridPanel。5.8.2 源码确认 UniformGridPanel 按分配空间均分，并对 Collapsed 行列特殊处理，不等价固定 CSS 轨道。
- `collection=tile` 语义目标 → UTileView + EntryWidgetClass；但精确 gap 映射标为 G。5.8.2 TileView 使用四周半间距，构建与尺寸 setter 在部分配置下走不同尺寸公式，不直接透传 CSS gap。不能用静态网格冒充已实现的 TileView。
- CSS 固定 N 列与 TileView 按可用宽度排布不总等价：首版锁定视口宽度、条目尺寸与滚动条占位策略，校验实际列数。不能宣称 TileView 原生有 CSS grid-template-columns=N 属性。[E5,E7]

### 6.5 集合、模板与数据

`collection=list` 支持横排/竖排；首版模板同构、条目等尺寸。变高 ListView 并非断言 UE 不支持，而是暂不纳入我们首版一致性保证。

模板由显式 entry/field 定义，不用“至少三个”作为集合判断；一个可见条目也能声明 list/tile，空集合需要显式模板资源。模板信息充分时不应让可见数量阻止生成。

生成：
1. 可编辑 Entry Widget Blueprint，满足 IUserObjectListEntry。
2. 一组 typed item records 与 UObject 数据适配。
3. 赋值入口将文本、图片、颜色等字段写入对应控件；复用 entry 时完整刷新，不残留上一条状态。
4. 预览数据与业务数据分离；不自动推断交互、选中逻辑或游戏绑定。

仅生成 EntryWidgetClass 而不提供 item/赋值路径，不能保证截图数据会显示。[E4]

5.8.2 补充：stock ListViewBase 无公共 EntryWidgetClass setter，可在 Editor 用类型校验后的属性反射配置，或专用子类封装；生成的 entry 应为继承 native 数据适配基类的 Widget Blueprint，不能直接指定纯原生 entry 类代替。设计时 dummy rows 跳过正常 item assigned 路径，逐条样例数据需独立实际实例预览或额外设计时注入，不能仅设置预览数量。

不同 props 值可变；结构不同应诊断或要求显式状态槽。装饰徽章隐藏策略要区分 Hidden（保留空间）和 Collapsed（不保留）。不能用错误的补节点伪造截图。

### 6.6 字体与图片

文本映射 TextBlock；font-family 必须绑定具体本地字体文件/字重，Web 与 UE 同源。禁止系统字体回退后假装一致。字体 DPI 与视口 DPI 是不同配置，profile 两者均记录。

5.8.2 源码推导：在 1 CSS px=1 Slate logical unit、font scale=1 条件下，候选 native Font.Size=cssPx×72/96，通过 SetFont 写入；SetFontSize 接收的却是显示字号，会再乘项目 FontDisplayDPI/96，因此不能混用。若用后者，输入 display=cssPx×72/FontDisplayDPI。该推导仅对应 em 单位关系，仍未验证字形、基线与取整；不是跨版本、跨缩放的无条件公式。详见源码核对 §7。[E9]

C 阶段先保证单行、有明确容器高度的文本；对字形抗锯齿不做逐像素相同承诺。多行换行、行高、基线是 G，必须拿中英文、长词、标点、不同字重测试。

图片建立资源表（source path、hash、dimensions、UE asset path、色彩空间）；object-fit:fill → Image 拉伸；contain/cover 候选 SizeBox + ScaleBox + Image，cover 加矩形 clip。未校验前不把 Image DrawAs=Box 当作 object-fit:contain 的等价实现。[E8]

### 6.7 可见性、裁剪与外观

- display:none → Collapsed；保留 IR 节点但不参与布局。
- visibility:hidden → Hidden；为避免 CSS 子元素能重新显示而 Slate 父隐藏的差异，首版禁止可见性反转。
- overflow:clip → 受控矩形 ClipToBounds，编译器需将 CSS padding-box 裁剪边界与 UMG 裁剪包装节点边界对齐；滚动是额外语义。hidden 在 CSS 中仍创建可程序滚动容器，因此不把它简单等同 ClipToBounds，首版拒绝。[E10,W5]
- 单色背景可用 Border/装饰层；无 padding 的 CSS 背景不能引入 UE 默认内容 padding。
- CSS opacity 是合成组语义；不能承诺父级 RenderOpacity 对重叠子节点严格等价，首版不开放容器 opacity。
- 圆角背景不自动意味着圆角裁剪，边框不只是 UBorder 的同名能力；需要 brush/装饰实现和专门测试。

## 7. IR 设计（新格式，不兼容旧版是允许的）

区分两层，避免把 CSS 与 Unreal 类名混成一棵大树：

**Semantic IR**
- meta：schemaVersion、targetProfile、designSize、font/DPI profile。
- nodes：稳定 id、kind、layout、size、decoration、text/image、visibility、children。
- slotIntent：margin、alignment、auto/fill、absolute offsets；属于父子边。
- collections：list/tile、orientation、templateRef、field schema、items、viewport、spacing。
- assets：可复现资源引用，不保存任意远端 URL。
- observations：浏览器 border/content rect、文字行框；仅验证证据，不能覆盖布局意图。
- sourceMap/diagnostics：HTML 文件与元素、CSS 声明位置、生成包装控件关联。

**UMG IR**
- Widget 类 + properties + Slot 类型/properties + generated wrappers。
- 独立 widget/entry 蓝图、资源导入和数据适配清单。
- 不支持的映射在 lowering 阶段明确失败，禁止静默删属性。

统一 JSON 仍适合机器交换；模型只创作 HTML/CSS。IR→Web 是编译后的语义预览，不是完整反向恢复源代码。

## 8. 错误与安全策略

- E_CSS_UNSUPPORTED：给出元素/声明/替代写法，不继续成功导出。
- E_LAYOUT_CONTEXT：例如 absolute 非直接 Canvas 子项、Fill 父级主轴不定。
- E_COLLECTION_TEMPLATE：模板/字段不一致、entry 尺寸或数据不合法。
- E_ASSET_MISSING：资源或字体缺失；不得默默换成系统字体。
- E_TARGET_CAPABILITY：profile 尚未验证的 G 功能。
- W_TEXT_METRICS：字形/基线偏差要人工复核；不能把布局溢出降为无关警告。

浏览器测量前等待本地字体加载、图片 decode、布局稳定；记录失败。禁止外网、JS、事件、导航、弹窗与文件越界；CSS url 也必须走资源白名单。由宿主注入测量脚本，与作者脚本分离。

超出子集时默认报错。若用户选择“将某个装饰栅格化”，必须显式确认并标注不可编辑范围；不自动将整屏截图冒充 UMG。

## 9. 验证关卡：先证明映射，再重构主体

### Phase A：锁定 target profile
已确认本地源码 5.8.2、路径及允许插件；采用 Editor + 小型 Runtime 数据适配的方案，无需每个界面手写 C++。设计分辨率、可用字体、DPI 配置在夹具 profile 中显式记录。按用户约束当前只做源码/工具层工作，后续 UE 编译与渲染验收暂不执行，也不阻止先实现带明确未验标记的工具链。

### Phase B：小型双端夹具（不先做大页面）

| 夹具 | 必验内容 |
|---|---|
| 固定尺寸 row/column | 0/1/多子项、两轴对齐、父级空间不足时的诊断 |
| padding/margin/gap | 四边不同值、最后一项无多余间距、嵌套包装 |
| Fill（G） | 1:2 比例、固定+填充混排、装饰厚度、零/负剩余空间 |
| Canvas | 嵌套、浮点坐标、兄弟 Z、缩放后坐标归一化 |
| 静态网格 | 1行、多行、末行缺项，不误生成 TileView |
| List/Tile | 1/2/多可见项、横竖、滚动复用、字段完整刷新、实际列数 |
| 文本 | 同字体中英文、字重、缺字检测、单行截断；多行另门控 |
| 图片 | 非正方形纹理、透明边、fill；contain/cover 另门控 |
| hidden/collapsed/clip | 隐藏保留空间、移除空间、嵌套裁剪 |
| 反例 | unsupported CSS、外网资源、脚本、非法结构必须失败 |

建议初始验收目标（待实验校准，不是已测结果）：相同设计坐标下非文本节点边界误差 ≤1 logical px；文本分别比较行数/行框/溢出与人工观感，不用字形逐像素差异作为唯一指标。验证 1x 与另一 UI scale，校验在 profile 声明的尺寸范围内；改变分辨率不等于自动支持所有响应式行为。

### Phase C：建立编译器
建议独立模块 authoring-spec / html-frontend / semantic-ir / umg-lowering / web-renderer / ue-plugin / fixtures。以 golden IR + 浏览器实测 + UE geometry 三重检查为基础。旧项目可保留作 legacy 示例，不先删除或原地破坏。

### Phase D：迁移 skill 与真实截图
给模型白名单、标准组件示例、错误修复指引；先出集合决策清单，再写网页。用实际失败截图回归：固定按钮、任务列表、装备槽、商店网格、带徽章条目。记录漏判/误判与视觉误差，而不只报告 JSON 校验通过。

## 10. 证据与来源

早期网页研究：Epic、W3C、MDN 直接全文抓取被网络工具拒绝（解析到非公网地址），网页依据是官方索引摘录。后续已按用户提供目录读取 5.8.2 本地布局、字体、列表与裁剪源码，路径和行号见 `ue-5.8-source-mapping.md`；未执行引擎构建/渲染，未对全部外观特性完成源码核对。新旧版本 API 不应混用。

- E1 [UHorizontalBoxSlot 5.5](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/UMG/Components/UHorizontalBoxSlot?application_version=5.5)
- E2 [UCanvasPanelSlot::SetOffsets 5.5](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/UMG/Components/UCanvasPanelSlot/SetOffsets?application_version=5.5)
- E3 [USizeBox 5.5](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/UMG/Components/USizeBox?application_version=5.5)
- E4 [UListView 5.5](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/UMG/Components/UListView?application_version=5.5)
- E5 [UTileView 5.5](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/UMG/Components/UTileView?application_version=5.5)
- E6 [UScrollBox 5.5](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/UMG/Components/UScrollBox?application_version=5.5)
- E7 [UMG Components 5.5](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/UMG/Components?application_version=5.5)
- E8 [EStretch 5.5](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Slate/Widgets/Layout/EStretch__Type?application_version=5.5)
- E9 [Font DPI Scaling](https://dev.epicgames.com/documentation/unreal-engine/font-dpi-scaling-in-unreal-engine)
- E10 [UMG Clipping](https://dev.epicgames.com/documentation/unreal-engine/clipping-for-umg-widgets-in-unreal-engine)
- W1 [CSS Flexbox specification](https://www.w3.org/TR/css-flexbox-1/)
- W2 [MDN box-sizing](https://developer.mozilla.org/en-US/docs/Web/CSS/box-sizing)
- W3 [MDN grid-template-columns](https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-columns)
- W4 [MDN containing block](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Containing_block)
- W5 [MDN overflow](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow)
- W6 [MDN visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/visibility)
- W7 [CSS font-size](https://www.w3.org/TR/CSS2/fonts.html#font-size-props)
- W8 [MDN line-height](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/line-height)

研究建议取舍：CSS 独立复核建议只允许显式行列定位及 margin:0；本提案为保留模型常用写法，选择额外支持“等尺寸固定轨道、默认行优先自动放置”与“仅 flex 子项的非负 px margin”。这是受约束扩展，不是宣称支持任意 Grid 或块级 margin；必须增加相应正反夹具验证。

以上是面向已确认 UE 5.8 的范围提案；待完成 5.8 API 复核与 Phase B 双端实验后，才能冻结为“已验证映射规范”。
