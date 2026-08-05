# 第二轮问题修复 Spec

## Why
第一轮修复了 Top 3 缓存/状态问题（facilitate_progress 未清除、双重写入、session 状态残留）。本轮继续修复剩余的功能逻辑缺陷和低风险 TypeScript 类型错误，提升代码健壮性。

## What Changes

**功能逻辑修复 (A~D):**
- A: `attempt1/page.tsx` 诊断文本不再带 `[用户]:`/`[AI]:` 中文标签
- B: `scenario/page.tsx` "生成交际任务"按钮添加防重复点击
- C: `facilitate/page.tsx` 移除 `attempt_number` 硬编码，改为前端推断
- D: `scenario/page.tsx` 历史场景卡片添加"重新分析"按钮

**低风险 TypeScript 修复:**
- 修复 `task/page.tsx` 和 `facilitate/page.tsx` 从 HistoryTaskSelector 导入 `ScenarioHistoryItem` 的路径
- 修复 `diagnosis/page.tsx` 的 `gaps` 可能为 null 的检查
- 修复 `report/[id]/page.tsx` 的 `report?.xxx` 可能为 undefined 的类型问题
- 修复 `facilitate/page.tsx` 的 comparison 类型问题
- 修复 `attempt1/page.tsx` 和 `attempt2/page.tsx` 中 `ScenarioHistoryItem` → `TaskData` 类型不兼容
- 修复 `attempt1/page.tsx:233` 隐式 `any` 类型

**高风险（暂不修复）:**
- SpeechRecognition / SpeechRecognitionEvent 类型声明
- facilitate/page.tsx setProgress 类型推断问题

## Impact
- Affected specs: 无（新 spec）
- Affected code:
  - `poa-project/poa-frontend/src/app/scenario/page.tsx`
  - `poa-project/poa-frontend/src/app/attempt1/page.tsx`
  - `poa-project/poa-frontend/src/app/attempt2/page.tsx`
  - `poa-project/poa-frontend/src/app/facilitate/page.tsx`
  - `poa-project/poa-frontend/src/app/diagnosis/page.tsx`
  - `poa-project/poa-frontend/src/app/report/[id]/page.tsx`
  - `poa-project/poa-frontend/src/app/task/page.tsx`

## ADDED Requirements

### Requirement A: 诊断文本格式优化
`attempt1/page.tsx` 在提交诊断时，SHALL 不再拼接 `[用户]:` / `[AI]:` 中文标签，改为直接传递原始对话文本。

#### Scenario: 用户提交诊断
- **WHEN** 用户完成对话后点击"提交诊断"
- **THEN** 传给后端的 `attempt_text` 由纯对话行 "\n" 拼接，不包含中文标签

### Requirement B: 防重复点击
`scenario/page.tsx` 的"生成交际任务"按钮 SHALL 在请求进行中时禁用，防止重复提交。

#### Scenario: 用户快速双击
- **WHEN** 用户点击"生成交际任务"按钮后 API 仍在请求中
- **THEN** 按钮保持禁用状态且显示"分析中..."，不会发起第二次请求

### Requirement C: attempt_number 动态推断
`facilitate/page.tsx` 在调用 `/api/facilitate/generate` 时，SHALL 根据上下文判断是第1轮还是第2轮产出后的促成学习，而非硬编码为 1。

#### Scenario: 第2轮产出后进入促成学习
- **WHEN** 用户从 attempt2 页面完成对话后进入 facilitate
- **THEN** API 请求中 `attempt_number` 为 2

### Requirement D: 手动重新分析按钮
`scenario/page.tsx` 的历史场景卡片 SHALL 提供"重新分析"按钮，允许用户对同一照片重新触发场景分析。

#### Scenario: 用户点击重新分析
- **WHEN** 用户点击历史场景卡片上的"重新分析"按钮
- **THEN** 系统使用该场景的原始照片重新调用 `/api/scenario/analyze`，生成新任务并替换历史记录中的旧条目

## MODIFIED Requirements

### Requirement: ScenarioHistoryItem 类型使用规范
所有页面 SHALL 从 `@/lib/store` 导入 `ScenarioHistoryItem` 类型，而非从 `@/components/HistoryTaskSelector`。后者仅为 React 组件导出。

### Requirement: gaps null 检查
`diagnosis/page.tsx` 在使用 `gaps` 变量时 SHALL 先检查非 null，避免运行时 TypeError。

### Requirement: report 类型安全
`report/[id]/page.tsx` 的组件 props SHALL 接受 `null | undefined`，或调用方先 `?? null` 处理。

### Requirement: attempt1/attempt2 TaskData 类型兼容
`attempt1/page.tsx` 和 `attempt2/page.tsx` 在 HistoryTaskSelector 的 `onSelected` 回调中将 `ScenarioHistoryItem` 赋值给 `TaskData` 类型时，SHALL 提取匹配字段创建新对象，而非直接赋值。
