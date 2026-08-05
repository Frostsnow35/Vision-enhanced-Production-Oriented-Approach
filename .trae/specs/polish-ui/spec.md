# UI 综合优化 Spec

## Why
当前8个页面存在视觉风格粗糙、交互体验不流畅、信息呈现层次混乱三类问题。POA 学习平台的闭环已走通（R1音频评分、R2任务质量均已就位），现在需要对前端界面进行系统性打磨，提升教学体验的专业感和可用性。

## What Changes
- 8个页面的视觉风格统一优化（配色/间距/字体/卡片样式）
- 录音触发交互体验增强（倒计时动画、松手确认、快捷键提示）
- 对话区滚动体验优化（自动滚底 + 手动上翻不强制跳转）
- Tab切换过渡动画
- 统一加载骨架屏
- 诊断页 Gap 卡片按严重程度排序和视觉层次
- 评价页雷达图增加数值标注
- 促成页 4 个 Tab 风格统一 + 进度指示
- 报告页时间线增加图标和颜色编码

## Impact
- Affected specs: 无（新 spec）
- Affected code: 
  - `poa-frontend/src/app/scenario/page.tsx`
  - `poa-frontend/src/app/task/page.tsx`
  - `poa-frontend/src/app/attempt1/page.tsx`
  - `poa-frontend/src/app/diagnosis/page.tsx`
  - `poa-frontend/src/app/facilitate/page.tsx`
  - `poa-frontend/src/app/attempt2/page.tsx`
  - `poa-frontend/src/app/evaluate/page.tsx`
  - `poa-frontend/src/app/report/[id]/page.tsx`
  - `poa-frontend/src/components/RecordingWaveform.tsx`
  - `poa-frontend/src/app/layout.tsx`（全局样式）

## ADDED Requirements

### Requirement: 录音交互增强
系统应当在录音触发过程中提供清晰的状态反馈和操作引导。

#### Scenario: 长按录音反馈
- **WHEN** 用户按下录音按钮超过 150ms
- **THEN** 按钮颜色变红、显示倒计时动画、波形图从灰色变为彩色脉冲、底部提示文字变为"松开停止"

#### Scenario: 键盘快捷键提示
- **WHEN** 页面首次加载且检测到摄像头就绪
- **THEN** 在录音按钮下方显示半透明提示文字"或长按空格键录音"，3秒后自动消失

#### Scenario: 录音时长限制可视化
- **WHEN** 用户录音持续时间超过 25 秒
- **THEN** 倒计时数字变为黄色；超过 28 秒变为红色闪烁，提示即将自动停止

### Requirement: 对话区滚动优化
系统应当自动滚动到最新消息，但不打断用户手动查看历史消息的行为。

#### Scenario: 新消息自动滚底
- **WHEN** 对话历史中新增一条 AI 或用户消息，且当前滚动位置在底部（距底部 < 50px）
- **THEN** 对话区自动滚动到底部，展示最新消息

#### Scenario: 手动上翻不跳转
- **WHEN** 用户手动滚动对话区查看历史消息
- **THEN** 后续新消息到达时不再自动滚动，直到用户再次手动滚回底部

### Requirement: 统一加载状态
系统应当在所有异步加载区域展示统一风格的骨架屏。

#### Scenario: 评价数据加载
- **WHEN** 评价页正在等待 `/api/evaluate-compare` 响应
- **THEN** 雷达图区域显示圆形旋转加载动画 + 下方各维度卡片显示灰色骨架条

#### Scenario: 促成材料加载
- **WHEN** 促成页正在等待材料生成 API 响应
- **THEN** 4 个 Tab 区域各自显示带脉冲动画的灰色骨架块

### Requirement: Tab 切换过渡动画
系统应当在促成页 Tab 切换时提供视觉过渡效果。

#### Scenario: Tab 内容切换
- **WHEN** 用户点击从"能力评估"切换到"核心词块"
- **THEN** 旧内容以淡出(200ms opacity 1→0)消失，新内容以淡入(200ms opacity 0→1)出现

### Requirement: 诊断页 Gap 卡片层次化
系统应当按照教学重要性对 Gap 卡片排序并给予不同的视觉权重。

#### Scenario: 严重程度排序
- **WHEN** 诊断页加载 Top 3 不足
- **THEN** 第 1 条 Gap（最严重）卡片使用红色左边框 + 较深背景色；第 2 条橙色；第 3 条灰色

### Requirement: 评价雷达图数值标注
系统应当在 ECharts 雷达图上显示具体分数数值。

#### Scenario: 双轨雷达图标注
- **WHEN** 评价页渲染双轨雷达图
- **THEN** 每个维度顶点旁显示初次产出分(蓝色)和二次产出分(橙色)的具体数值，格式为"A1:3.2 / A2:4.1"

### Requirement: 促成页 Tab 进度指示
系统应当在促成页 Tab 标签上显示学习进度状态。

#### Scenario: Tab 未访问状态
- **WHEN** 用户首次进入促成页
- **THEN** "核心词块""示范对话""巩固练习"三个 Tab 标签旁显示灰色圆点

#### Scenario: Tab 已完成状态
- **WHEN** 用户完成某个 Tab 的学习（如完成所有练习）
- **THEN** 该 Tab 标签旁的圆点变为绿色对勾

### Requirement: 报告页时间线增强
系统应当在证据链报告的时间线卡片上增加图标和颜色编码。

#### Scenario: 阶段图标
- **WHEN** 报告页渲染时间线
- **THEN** "场景驱动"阶段卡片左侧显示相机图标；"初次产出"显示麦克风图标；"诊断"显示放大镜图标；"促成学习"显示书本图标；"二次产出"显示重复图标；"双轨评价"显示图表图标

#### Scenario: 颜色编码
- **WHEN** 报告页渲染时间线
- **THEN** 每条时间线卡片的左边框颜色按阶段类型区分：场景驱动=蓝色、产出尝试=紫色、诊断=红色、促成=绿色、评价=橙色

### Requirement: 场景页布局优化
系统应当在场景选择页适当放大主操作区域，压缩历史记录区域的视觉权重。

#### Scenario: 上传区优先
- **WHEN** 用户进入 `/scenario` 页面
- **THEN** 上传/拖拽区域占据页面中央主要视觉面积（约 60%），历史记录区改为底部横向滚动卡片行（约 20%）

### Requirement: 任务卡信息层次化
系统应当将 POA 任务卡的信息分层展示，重点信息前置。

#### Scenario: 任务卡折叠
- **WHEN** 用户进入 `/task` 页面
- **THEN** 默认展开"场景+角色+目标"核心区；"约束条件"和"评价标准"折叠为可展开区域

## MODIFIED Requirements
无。本次为新增需求，不改动现有功能逻辑。

## REMOVED Requirements
无。
