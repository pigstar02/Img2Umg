# UE 5.8.2 源码核对：HTML/CSS → UMG

## 核对范围与可信度

- 用户提供引擎：`/Users/pigstar/Documents/UnrealEngine-5.8`。
- `Engine/Build/Build.version:2–9`：5.8.2，Changelist=0，CompatibleChangelist=55116800，BranchName=UE5。这里只确认该源码树声明的版本，不据此判断二进制发行状态。
- 下列路径均相对该目录的 `Engine/Source/Runtime/`；行号对应本次读取的源码。
- 本轮仅只读源码、修改项目设计文档；未编译插件、未运行引擎、未修改 Engine。不是编译通过或像素一致性报告。
- 两项并行研究在发送中间发现后中断，最终结果由主会话补读相关实现核对，不将未返回的分析当作证据。

## 1. Box Auto/Fill：UMG 和 Slate 暴露能力不同

### 源码证据

- `UMG/Private/Components/HorizontalBoxSlot.cpp:12–20,30–41,65–71`：默认两轴 Fill；主轴默认 Automatic；构建/更新使用 ConvertSerializedSizeParamToRuntime。
- `UMG/Private/Components/Widget.cpp:1723–1732`：Automatic → FAuto，Fill → FStretch(Value)。
- `SlateCore/Public/Layout/LayoutUtils.h:851–920`：先扣所有非 Collapsed 子项的 Slot Padding；Auto 加入固定尺寸；Stretch 的 basis 为 0。
- 同文件 `929–958`：可用空间下限为 0，按权重分配给 Stretch。
- 同文件 `897–910,960–1080`：Slate 还存在 StretchContent，具有内容基准、增长、收缩和有限轮数约束处理；普通 UMG FSlateChildSize 转换没有进入这一分支。

### 决策

不能宣称“5.8 Slate 没有 flex-like 收缩算法”，但也不能宣称“普通 UMG Box 已完整支持 CSS Flex”。首版只使用 stock UMG 的 Auto；受限 Fill 保留为待验证功能。

受限 Fill：父主轴明确；`flex:n 0 0px`；正权重；无额外 min/max；外壳 margin/padding/border 归零；装饰放内层；拒绝负剩余空间。不能将所有 `flex:1`/`flex:auto` 通配翻译。

`flex:0 0 auto`：有明确主轴尺寸时为 fixed，没有才可能是 intrinsic；不是 Fill。

## 2. SizeBox 与交叉轴：显式尺寸可能仍被父级夹小

### 源码证据

- `Slate/Private/Widgets/Layout/SBox.cpp:124–139`：Width/HeightOverride 决定 desired size；子项 Collapsed 时返回零。
- 同文件 `187–197`：排列用实际 AllottedGeometry 调用 AlignChild。
- `SlateCore/Public/Layout/LayoutUtils.h:680–722`：AlignChild 默认 `bClampToParent=true`；非 Fill 子项也把 desired size 限制到可用尺寸。
- 同文件 `715–716`：中心对齐公式是 `(AllottedSize-ChildSize)/2 + MarginPre-MarginPost`，不可把不对称 CSS 外边距简单复制到这一 Slot 后假定中心位置相同。

### 决策

1. 明确的 width/height 必须结合父 Slot 验证，不能只加 SizeBox。
2. 首版拒绝“交叉轴固定子项大于父级可用空间”的 stock Box 映射；不要把被夹小的结果误称为 CSS overflow 行为。
3. 居中对齐与该轴不对称 margin/padding 的直接 Slot 映射先拒绝，后续通过外围包装层标准化再开放。对齐属性是支持的，不代表所有组合都支持。
4. 父 padding、子 margin、gap 在 IR 中分开，避免同一间距重复扣除。
5. gap 根据实际参与布局的序列计算（Hidden 保留，Collapsed 排除），不能把间距永远绑定到原 DOM 的“末项”。首版静态状态可编译时归一化；运行时动态显隐需额外刷新逻辑。

## 3. Canvas：公式已确认

`Slate/Private/Widgets/Layout/SConstraintCanvas.cpp:240–280`：

- anchor pixels 由父尺寸乘 anchors 得到。
- 非伸展轴：position = anchorMin + offsetStart - size × alignment；size 来自 offsetEnd 或 AutoSize desired size。
- 伸展轴：position = anchorMin + offsetStart；size = anchorMax - position - offsetEnd。

因此首版约束成立：直接 Canvas 父项、无 Canvas padding/border、左上 anchor=(0,0)、alignment=(0,0)、AutoSize=false；left/top/width/height px 分别落到 position/size。

right/bottom/百分比不是缺 API，而是另一个布局契约；未定义前不接受。

## 4. 静态 CSS Grid：不直接选 UniformGridPanel

`Slate/Private/Widgets/Layout/SUniformGridPanel.cpp:52–73`：格子尺寸是父级分配空间除以行列数，而非 CSS 固定轨道宽高。

同文件 `99–142`：行列由现有槽位索引推导；Collapsed 行列参与特殊折叠；desired size 取最大子项并乘行列数。

决策：固定 `repeat(N,Wpx)` 网格首版 lowering 选固定尺寸行/列组合（VerticalBox + HorizontalBox + SizeBox），显式保存轨道数与 gap。保留末行空轨道所需占位；不要因只有一项就把 N 列压成一列。静态 display:none 项先按 CSS 自动放置规则过滤重排；不承诺任意运行时动态变更无需重新布局。

不默认使用 UniformGridPanel，也不把格子视觉重复认定为 TileView。UniformGridPanel 可以留给后续“平均分配空间”的独立语义。

## 5. ListView gap 与 TileView gap 不是同一公式

### ListView

`UMG/Private/Components/ListView.cpp:487–503`：首个数据项无间距；后续项在主轴前侧加 spacing。这与简单单行/列 CSS gap 的外沿语义一致，前提是无额外 row padding、模板装饰或滚动条误差。

### TileView

- `UMG/Private/Components/TileView.cpp:21–47`：条目四周放半份横/纵 spacing；计算 total entry 尺寸时有 alignment 和 includesSpacing 分支。
- `UMG/Public/Components/TileView.h:64–77,112–118`：构建时，aligned 且不包含 spacing 才用 total 尺寸；否则用 raw EntryWidth/Height；includesSpacing 默认 true，且是 private。
- `UMG/Private/Components/TileView.cpp:50–65`：运行时尺寸 setter 使用 GetTotalEntryWidth/Height。某些配置下与初次构建的 raw 尺寸路径不同，不能保证调用先后顺序无影响。
- `Slate/Public/Widgets/Views/STileView.h:450–456`：实际列数按 panel 的行轴可用尺寸除以 tile 行轴尺寸向下取整，至少 1。
- `Slate/Private/Widgets/Views/STableViewBase.cpp:175–257`：内部 scrollbar 是旁侧 Auto 槽，items panel 为 Fill；不能用整个控件宽度直接算列数。

### 决策

TileView 的 CSS gap/边界精确映射设为 **G：不通过运行测试就不宣称可用**。禁止简单 `EntryWidth=W;HorizontalSpacing=gap`。

后续可选方案：插件 UTileView 子类统一构建/尺寸更新、明确 entry padding 与槽位 pitch，或限制零间距后先打通数据链路。需要覆盖：首尾半间距、末行、滚动条出现/消失、rebuild 与 setter 一致性。不要猜一个常量补偿就宣布解决。

## 6. EntryWidgetClass 和数据适配

- `UMG/Public/Components/ListViewBase.h:599,815–816`：有 getter；EntryWidgetClass 为受保护属性，此头文件未发现公共 setter。
- `UMG/Private/Components/ListViewBase.cpp:201–228`：Editor 中非 cooked entry 检查 Blueprint 来源及 BP 错误状态；直接使用纯原生 entry 类不满足该检查。
- `UMG/Private/Blueprint/IUserObjectListEntry.cpp:14–33`：item assigned 分派到 native 实现或 Blueprint 事件。
- `UMG/Public/Slate/SObjectTableRow.h:162–176`：设计时不走正常 InitializeObjectRow/ResetObjectRow。

插件设计：生成 Entry Widget Blueprint，继承实现 IUserObjectListEntry 的通用 native 基类；使用安全类型字段映射，将数据赋给可编辑控件。条目复用时每个字段完整赋值/恢复，不只打差量补丁。

EntryWidgetClass 在 Editor 导入时可用受控反射设置 stock 控件属性（校验类型、接口、BP 编译状态），或使用提供配置接口的插件子类；不得伪造不存在的 stock setter。普通 ListView 优先 Editor 设置属性；TileView 若需要统一构建路径再引入专用子类，不修改 Engine 源码。

Widget Designer 的 dummy rows 不会自动显示每条记录的样例数据。首版真实数据预览应通过独立预览场景/实际 widget 实例路径实现；Designer 只承诺模板效果，除非额外完成专门的设计时样例注入。

“本轮不编译插件”只表示交付源码/设计不执行构建，不意味着 C++ 插件最终能免编译加载。未来用户使用时仍需适配 5.8.2 构建或预编译二进制。

## 7. 字号：显示值与 native 值必须分开

### 调用链

- `UMG/Private/Components/TextBlock.cpp:279–296`：SetFontSize(DisplayFontSize) 先转 native；GetFontSize 反向转换。
- `Engine/Private/UserInterfaceSettings.cpp:173–198`：display DPI 可为 96/72/custom；native=GridSnap(display×D/96,0.01)，display=native×96/D。
- `SlateCore/Public/Fonts/SlateFontInfo.h:15`：RenderDPI=96。
- `SlateCore/Private/Fonts/FontCacheFreeType.cpp:119–147`：native 字号经 96/72 与 font scale 转为字体像素尺寸，并执行固定精度运算/像素取整。

### 5.8.2 候选映射（已由源码推导，未运行验证）

在 `1 CSS px = 1 Slate logical unit`、字体资源相同、font scale=1 的 profile 下：

```text
nativeFontSize = cssFontSizePx × 72 / 96
```

推荐构建 FSlateFontInfo 并调用 SetFont，明确传 native 值。若使用 SetFontSize，必须先转换到显示值：`display = cssPx × 72 / D`，D 为项目 FontDisplayDPI。

例如 CSS 16px → native 12；D=72 时显示值为 16，D=96 时显示值为 12。不能 native 换算后又误用 SetFontSize 导致二次转换。

这只建立 em size 的单位关系，不能保证字形边界、字距、baseline、抗锯齿和浏览器完全相同；不同 DPI、缩放与 hinting 必须另测。

### 行高

`Slate/Private/Framework/Text/TextLayout.cpp:448–456`：行高基于实际 above/below baseline 度量乘 LineHeightPercentage，不是简单 CSS font-size×line-height 倍数。

`UMG/Private/Components/TextWidgetTypes.cpp` 提供 wrap width、line-height percentage、是否应用末行的 setter（本轮检索确认，未做完整多行算法审查）。任意 CSS line-height、wrap、ellipsis 继续 G；单行也需记录 profile 的基线校准方式。

## 8. Clipping 与透明度

- `SlateCore/Private/Widgets/SWidget.cpp:1420–1465`：ClipToBounds 与父裁剪相交；WithoutIntersecting 则不相交。CSS 的普通嵌套矩形 clip 不应映射到 WithoutIntersecting。
- 同文件 `1487–1490`：RenderOpacity 混入传递给内容的 WidgetStyle；不是在这里将整棵子树先离屏合成再乘 alpha。

维持首版：只接受双轴 overflow:clip/visible；clip 节点几何匹配 CSS padding box，拒绝圆角裁剪、transform。容器 opacity 不纳入等价映射；单叶透明度也须按绘制类型验证。

## 9. 本轮冻结的决定与保留项

### 可以据源码固定的设计

- 目标 5.8.2、Editor/Runtime 分模块、无 Engine 修改。
- 不把 stock Box 当完整 Flexbox；IR 保留 fixed/intrinsic/fill。
- 固定 px Grid 用行列组合，不直接用 UniformGridPanel。
- List/Tile 显式语义，不依赖数量阈值或视觉指纹自动替换。
- native 字号与项目显示字号分别保存/转换。
- Entry 必须生成 Widget Blueprint，设计预览与真实数据路径区分。
- 未支持的属性或组合报错，不偷偷丢弃或整屏截图化。

### 仍须验证，不能声称已完成

- 插件 UHT/C++ 编译、蓝图生成/保存与打包。
- TextBlock/browser 的基线和字形度量一致性。
- Fill、TileView gap/列数、滚动条策略、条目复用。
- 颜色、图片、圆角、ScaleBox、复杂可见性等未作完整源码到渲染审查。

下一实现步骤可以在不构建插件的约束下开展：机器可读白名单与 IR schema → 浏览器前端提取及纯工具测试 → 插件源码。任何源码测试结果都不能替代未来的 UE 编译/运行验证。
