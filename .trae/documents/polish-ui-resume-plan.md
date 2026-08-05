# Polish-UI 恢复执行计划

## 摘要

polish-ui spec 中 10 个 Task 均未完成，但大部分核心基础设施（全局配色、组件、session 状态）已就位。本计划按"先低风险收敛基础，再逐页面打磨细节"的策略，将剩余工作重组为 4 个执行阶段，每个阶段产出可独立验证。

## 当前状态分析

### 已完成/就位的部分
- globals.css：全新撞色方案（深蓝+亮黄）、CSS 变量（--card-padding/--card-shadow 等）、@layer components（.card/.btn-hover/.input-base）、关键帧动画（float/gradient-text/skeleton-pulse）
- RecordingWaveform.tsx：实时音频波形可视化组件（Web Audio API + canvas）
- HistoryTaskSelector.tsx：场景历史选择器（含缩略图、重新分析、删除按钮）
- diagnosis/page.tsx：诊断页面（含 Gap 卡片列表和 HistoryTaskSelector 集成）
- 所有页面已集成 session 状态管理（isTaskSelectedInSession/markTaskSelectedInSession）

### 未完成的关键差距

| polish-ui Task | 当前差距 |
|---|---|
| Task 1 全局样式 | 新 CSS 类 (.card/.btn-hover) 已定义但 8 个页面未统一使用，仍用直接 Tailwind 类 |
| Task 2 录音交互 | 键盘空格快捷键已实现，但缺：倒计时颜色变化（25s 黄→28s 红）、键盘提示 3s 自动消失、波形图录音中脉冲 |
| Task 3 对话滚动 | 完全未实现：无 auto-scroll-to-bottom 逻辑、无"回到底部"按钮 |
| Task 4 骨架屏 | animate-skeleton 类已定义，但无 SkeletonCard 组件、各页面仍旧用文本 loading |
| Task 5 Tab 动效 | Tab 进度圆点已实现，但缺：内容切换 CSS transition（淡入淡出） |
| Task 6 Gap 层次 | 诊断页 Gap 卡片无反/橙/灰左边框排序，无"最需关注"角标 |
| Task 7 评价增强 | 雷达图已有双线对比，但缺：顶点数值标注、维度进度条缺少具体数值 |
| Task 8 报告增强 | 时间线用 emoji 图标代替 Lucide 图标，无阶段颜色编码左边框 |
| Task 9 场景布局 | 历史卡片横向滚动已实现，但上传区/历史区视觉比例未达 60/20 |
| Task 10 任务卡折叠 | 完全未实现：约束条件+评价标准仍平铺展示 |

## 执行策略

按"**先基础 → 后页面细节**"的顺序重组任务，保证每阶段完成后可独立验证。

---

## Phase 1：基础统一收敛（Task 1 + Task 3）

> 目标：让所有页面视觉风格一致 + 对话滚动可用。这是 polish-ui 的"地基"。

### Step 1.1：页面统一应用 .card 等新 CSS 类

**影响文件**（8 个页面 + 2 个组件）：
- `src/app/scenario/page.tsx` — 上传区卡片、历史卡片
- `src/app/task/page.tsx` — 任务详情卡片
- `src/app/attempt1/page.tsx` — 顶部任务摘要、控制栏
- `src/app/diagnosis/page.tsx` — Gap 卡片
- `src/app/facilitate/page.tsx` — 内容区卡片
- `src/app/attempt2/page.tsx` — 同 attempt1
- `src/app/evaluate/page.tsx` — 维度卡片
- `src/app/report/[id]/page.tsx` — 时间线、统计卡片
- `src/components/GapList.tsx` — Gap 卡片容器
- `src/components/RecordingWaveform.tsx` — 波形图容器

**改造方式**：将现有 `rounded-lg border border-border bg-card p-8 shadow-sm` 装饰类替换为全局的 `.card` 类，按钮添加 `.btn-hover`。

### Step 1.2：对话区滚动优化（attempt1 + attempt2）

**影响文件**：
- `src/app/attempt1/page.tsx`
- `src/app/attempt2/page.tsx`

**实现逻辑**：
1. 使用 `useRef<HTMLDivElement>` 引用对话滚动容器
2. 添加 `useEffect` 监听 conversation/history 变化，计算 `scrollHeight - scrollTop - clientHeight < 50` 时自动滚底
3. 添加 `onScroll` 事件：手动上翻超过 100px 时，显示浮动"回到底部"按钮
4. 点击"回到底部"后恢复自动滚动

**验收**：新消息到达时自动滚底；手动上翻后暂停自动滚动，出现回到底部按钮。

---

## Phase 2：加载体验 + Tab 动效（Task 4 + Task 5）

### Step 2.1：创建通用 SkeletonCard 组件

**新建文件**：`src/components/ui/skeleton-card.tsx`

基于 globals.css 已有的 `.animate-skeleton` 类，创建灵活骨架屏组件：
- 支持 `lines` (行数)、`width` (宽度)、`height` (高度) 属性
- 圆形变体（用于雷达图区域）
- 卡片变体（用于 Gap 卡片区域）

### Step 2.2：评价页/促成页/诊断页接入骨架屏

**影响文件**：
- `src/app/evaluate/page.tsx` — 加载中替换文本 loading 为骨架屏
- `src/app/facilitate/page.tsx` — 材料加载中/能力评估加载中替换为骨架屏
- `src/app/diagnosis/page.tsx` — 加载中替换

### Step 2.3：促成页 Tab 内容切换过渡动画

**影响文件**：`src/app/facilitate/page.tsx`

在 Tab 内容区添加 CSS transition：
```tsx
<div className="transition-opacity duration-200" key={tab}>
  {/* tab content */}
</div>
```

利用 React `key` 属性触发自然挂载/卸载，配合 Tailwind transition。

**验收**：切换 Tab 时旧内容淡出(200ms)、新内容淡入(200ms)。

---

## Phase 3：页面细节打磨（Task 6 + Task 10 + Task 8 + Task 9）

### Step 3.1：诊断页 Gap 卡片视觉层次

**影响文件**：`src/app/diagnosis/page.tsx`

1. 对 gaps 按严重程度排序（默认第 1 条最严重）
2. 添加左边框颜色：第 1 条红色 + "最需关注"角标；第 2 条橙色；第 3 条灰色
3. 角标使用绝对定位 `<span className="absolute -top-2 -right-2 ...">最需关注</span>`

### Step 3.2：任务卡信息层次化（可折叠）

**影响文件**：`src/app/task/page.tsx`

1. 默认展开：场景标签 + 角色设定 + 交际目标
2. 折叠区使用 `<details>` 或 useState 控制：
   - "语境限制" 折叠（如有 context_constraints）
   - "评价标准 + 难度变体" 折叠
3. 折叠按钮带展开/收起图标动画

### Step 3.3：报告页 Lucide 图标 + 颜色编码

**影响文件**：`src/app/report/[id]/page.tsx`

1. 安装 lucide-react（如未安装）:`npm install lucide-react`
2. 将 7 个阶段 emoji 替换为 Lucide 图标：
   - 场景 → Camera
   - 任务 → ClipboardList
   - 初次产出 → Mic
   - 诊断 → Search
   - 促成 → BookOpen
   - 二次产出 → Repeat
   - 评价 → BarChart3
3. TimelineNode 添加 `borderColor` prop，按阶段分色：
   - 场景=蓝色、产出=紫色、诊断=红色、促成=绿色、评价=橙色

### Step 3.4：场景页视觉权重调整

**影响文件**：`src/app/scenario/page.tsx`

1. 上传区容器添加 `min-h-[320px]` 类增大视觉高度
2. 拖拽区域增大内边距和图标，让上传引导更突出
3. 历史区保持横向滚动但压缩为紧凑卡片（当前 w-40 已较合理）

---

## Phase 4：录音交互 + 评价雷达图收尾（Task 2 + Task 7）

### Step 4.1：录音倒计时颜色变化

**影响文件**：`src/app/attempt1/page.tsx`、`src/app/attempt2/page.tsx`

在录制过程中根据 elapsed 值改变按钮样式：
- elapsed >= 25：按钮变黄色（`bg-amber-500`）
- elapsed >= 28：按钮变红色并闪烁（`animate-pulse bg-destructive`）
- elapsed >= 30：自动停止录音（已通过 30s 限制实现）

### Step 4.2：键盘快捷键提示自动消失

**影响文件**：`src/app/attempt1/page.tsx`、`src/app/attempt2/page.tsx`

添加半透明提示文字"或长按空格键录音"，摄像头就绪后显示，3s 后自动消失：
```tsx
const [showHint, setShowHint] = useState(true);
useEffect(() => {
  if (cameraReady) {
    const timer = setTimeout(() => setShowHint(false), 3000);
    return () => clearTimeout(timer);
  }
}, [cameraReady]);
```

### Step 4.3：评价页雷达图数值标注

**影响文件**：`src/app/evaluate/page.tsx`

在 ECharts 配置中增加：
1. `label: { show: true, formatter: ... }` 在 series 上，显示具体分数
2. 或在雷达图下方增加 A1/A2 分数对比表格

---

## 验证方案

每阶段完成后执行：

1. **Phase 1**：`npm run build` 无报错 → 检查各页面卡片样式统一 → 手动测试对话滚动
2. **Phase 2**：检查评价页/促成页 loading 态显示骨架屏 → 切换促成页 Tab 有过渡动画
3. **Phase 3**：诊断页 Gap 有红/橙/灰边框 → 任务卡可折叠 → 报告页用 Lucide 图标
4. **Phase 4**：录音 25s 按钮变黄、28s 变红 → 键盘提示 3s 消失 → 雷达图有数值标注

---

## 假设与决策

| 决策点 | 决定 | 理由 |
|---|---|---|
| 执行顺序 | Phase 1→2→3→4 | 基础→体验→页面→收尾，每阶段可独立验证 |
| Task 4 骨架屏优先级 | 排 Phase 2 | 各页面 loading 态过于简陋，影响整体体验 |
| Task 9 场景布局 | 仅微调不改大结构 | 当前布局可用，大改风险高且收益有限 |
| ECharts 数值标注 | 用 series label 直接标注 | 不影响现有图表布局 |
| Lucide 图标 | 安装并替换 7 个 emoji | 提升专业感，安装零风险 |
