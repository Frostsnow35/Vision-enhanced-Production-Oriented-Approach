# 核心功能增强 Spec（实时反馈 + 学习旅程 + 针对性促成）

## Why
当前项目虽然七维评估体系已就位、基础 POA 闭环可走通，但仍有三个关键体验缺口未填补：(1) 用户在 attempt1/attempt2 对话过程中得不到即时反馈，错误直到 evaluate 页才暴露；(2) 用户的"学习历程"完全无感知，每次都是冷启动，缺乏 Viseal.ai 那样的"持续成长感"；(3) 促成学习页的练习内容是模板化的，没有真正基于诊断 gaps 提供针对性训练。补齐这三块将显著提升学习闭环的有效性。

## What Changes

### 1. 实时反馈（每轮对话后）
- 后端 `chat-turn` API 在响应中新增 `turn_feedback` 字段，包含：本轮涉及维度（≤3个）+ 短评（15-30字）
- 短评由 LLM 实时生成，要求引用本轮对话原文中具体证据
- 前端 attempt1/attempt2 页面在 AI 消息下方显示反馈 Mini 卡片
- 卡片可一键折叠

### 2. 学习旅程（首页 dashboard）
- 前端 `lib/store.tsx` 新增 `learningJourney: JourneyEntry[]` 字段
- 每次 evaluate 完成时写入 entry（场景、任务、时间、七维分数）
- 首页 `/` 顶部添加"学习旅程"区域，显示最近 5 条 entry
- 每条 entry 显示：场景标签 + 任务标题 + 总体均分 + 七维小雷达图
- 提供"清空旅程"操作

### 3. 促成学习针对性练习
- 前端 attempt1 完成时（`isFinal`）自动将诊断结果写入 `localStorage.diagnosis`
- 现有 facilitate 页读取该 diagnosis，调用后端 `/api/generate-input` 时传入 gaps
- 后端 `/api/generate-input` 基于具体 gaps 调整 prompt，返回针对性更强的练习
- 练习卡片显示"针对你刚才的 X 问题"的标题前缀

## Impact

### Affected specs
- 继承：urgent-fixes-and-eval-refactor（评估体系基础）

### Affected code
- `poa-backend/services/chat_service.py` - chat-turn 返回 turn_feedback
- `poa-backend/routers/chat.py` - 响应模型加 turn_feedback
- `poa-backend/routers/facilitate.py` 或 `services/facilitate_service.py` - /generate-input 接受 gaps
- `poa-backend/services/llm_service.py` - LLM 调用支持短反馈 prompt
- `poa-frontend/src/lib/store.tsx` - learningJourney state
- `poa-frontend/src/lib/api.ts` - chatTurn 类型加 turn_feedback
- `poa-frontend/src/app/attempt1/page.tsx` - Mini 反馈卡片 + 写入 diagnosis
- `poa-frontend/src/app/attempt2/page.tsx` - Mini 反馈卡片
- `poa-frontend/src/app/evaluate/page.tsx` - evaluate 完成时写入 journey
- `poa-frontend/src/app/page.tsx` - 学习旅程区域
- `poa-frontend/src/app/facilitate/page.tsx` - 读取 diagnosis + 传 gaps

## ADDED Requirements

### Requirement: 实时反馈短评
后端 chat-turn 必须在响应中返回 `turn_feedback`，含本轮涉及维度（≤3个）+ 短评（15-30字，引用本轮原文）。

#### Scenario: 用户输入后 AI 回复
- **WHEN** 用户提交一条对话
- **THEN** 响应中 `turn_feedback` 字段包含：
  ```json
  {
    "dimensions": ["语法规范性", "词汇适配性"],
    "short_comment": "时态应改为 'I would like'（现误用 'I want'）；"
  }
  ```
- 短评必须引用用户本轮输入的原文中具体词句
- 短评长度 15-30 字（中文计数）

### Requirement: 实时反馈 Mini 卡片
前端 attempt1/attempt2 页面在 AI 消息下方显示 Mini 反馈卡片。

#### Scenario: AI 回复后
- **WHEN** AI 回复成功
- **THEN** 该 AI 消息下方显示一个紧凑的反馈卡片：
  - 包含涉及的维度标签（最多 3 个，带不同颜色）
  - 短评（30 字以内）
  - 卡片可一键折叠（点击右上角小箭头）
- 卡片默认展开

#### Scenario: AI 回复失败（降级 Mock）
- **WHEN** AI 回复走 Mock 降级
- **THEN** 不显示反馈卡片（避免误导）

### Requirement: 学习旅程记录
前端在 evaluate 完成时写入一条 JourneyEntry 到 store。

#### Scenario: 评估完成
- **WHEN** 用户在 evaluate 页面看到七维结果
- **THEN** 系统自动调用 `addJourneyEntry({ scene, taskTitle, scores, completedAt })` 写入 localStorage
- 写入时若场景已存在，则更新对应 entry（保留最近 1 条）

#### Scenario: 写入字段
JourneyEntry 包含：
```ts
{
  id: string;
  sceneLabel: string;
  taskTitle: string;
  completedAt: number; // 时间戳
  avgScore: number;    // 二次产出七维均分
  dimensionScores: Record<string, { attempt1: number; attempt2: number; change: number }>;
  imageUrl?: string;   // 可选：场景缩略图
}
```

### Requirement: 学习旅程首页展示
首页 `/` 在顶部 Hero 区域下方添加"学习旅程"卡片。

#### Scenario: 用户首次访问
- **WHEN** learningJourney 为空
- **THEN** 显示空态卡片："还没有学习记录，开始你的第一次实景对话吧！"

#### Scenario: 用户有历史记录
- **WHEN** learningJourney 长度 >= 1
- **THEN** 显示最近 5 条 entry，每条包含：
  - 场景标签
  - 任务标题（前 30 字）
  - 总体均分（圆环显示）
  - 完成时间（相对时间，如"2 天前"）
  - 点击 entry 跳转到对应 report 页（若有 id）

### Requirement: 针对性促成练习
facilitate 页面在生成练习时传入诊断 gaps。

#### Scenario: 读取诊断数据
- **WHEN** 用户进入 `/facilitate` 页面
- **THEN** 自动从 `localStorage.diagnosis` 读取 gaps（来自 attempt1 完成时）
- 加载时显示 Loading 状态
- 若诊断为空，调用 `/api/generate-input` 不传 gaps（降级为通用练习）

#### Scenario: 调用后端
- **WHEN** 后端接收 `/api/generate-input`
- **THEN** 若 request body 包含 `gaps: [...]`，prompt 调整为：
  "请基于以下诊断问题生成针对性练习：gaps 描述"
- 生成的练习标题前缀："针对你的 X 问题"

#### Scenario: 练习卡片显示
- **WHEN** 练习渲染
- **THEN** 顶部显示"针对你的 [gap 主题]" 红色提示
- 练习题干与诊断问题强相关（如 gap 是"礼貌表达"，练习内容是"选择合适的 please/could you"题）

## MODIFIED Requirements
无。

## REMOVED Requirements
无。
