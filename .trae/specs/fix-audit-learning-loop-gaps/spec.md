# 学习闭环审计缺陷修复 Spec

## Why
上一轮审计发现初次产出、二次产出和诊断报告三个环节共 6 个功能缺陷，直接影响 POA 学习闭环的效果：AI 不知是第二次尝试导致教学策略未调整、报告页硬编码跳转失效、反馈挂错对象、诊断缺少说话人标记、报告缺失进步对比、音频未用于发音评分。

## What Changes
- 后端 `generate_reply` 和 `generate_opening` 注入 `is_second_attempt` 上下文，告知 AI 学生已完成初次练习
- 修复 `evaluate/page.tsx` 中"查看完整学习证据链"按钮硬编码 `report/1`
- 将 `turn_feedback` 从 AI 气泡下方移到用户气泡下方
- 提交诊断时 `conversationText` 使用 `[user]: xx\n[ai]: yy` 格式
- `report/[id]` 页的 `EvaluationContent` 展示 attempt1 分数和变化量
- `attempt1/submit` 后端接收并利用 `audio_urls` 做发音评分

## Impact
- Affected specs: 无（纯修复）
- Affected code:
  - `poa-backend/services/chat_service.py` — generate_reply / generate_opening 注入二次尝试上下文
  - `poa-backend/routers/attempt.py` — attempt1/submit 接收 audio_urls 传递给 evaluate
  - `poa-backend/services/evaluate_service.py` — evaluate_single 接收 audio_paths（已支持，仅需确认）
  - `poa-frontend/src/app/evaluate/page.tsx` — 动态 scenarioId 跳转
  - `poa-frontend/src/app/report/[id]/page.tsx` — 展示进步对比
  - `poa-frontend/src/app/attempt1/page.tsx` — conversationText 格式 + 反馈位置
  - `poa-frontend/src/app/attempt2/page.tsx` — 反馈位置

## ADDED Requirements

### Requirement: AI 感知二次尝试上下文
`generate_reply` 和 `generate_opening` 在构建 system message 时，当 `is_variant == True` 且 `variant_context` 存在时，SHALL 追加上下文告知 AI 这是学生的第二次练习。

#### Scenario: attempt2 变体对话
- **WHEN** `is_variant == True` 且 `variant_context = "顾客发现订单有误"`
- **THEN** system message 包含：`"This is the student's SECOND attempt at this scenario. They have completed one round, received diagnostic feedback, and been given learning materials. The scenario now has a new twist: 顾客发现订单有误. You should maintain the same teaching role but note that the student is expected to show improvement."`

#### Scenario: attempt1 正常对话
- **WHEN** `is_variant` 为 False 或缺失
- **THEN** system message 不包含二次尝试上下文

### Requirement: 动态 scenarioId 跳转报告
evaluate 页的"查看完整学习证据链"按钮 SHALL 使用当前任务的实际 scenarioId 而非硬编码 `1`。

#### Scenario: 查看报告
- **WHEN** 用户在 evaluate 页点击"查看完整学习证据链"
- **THEN** 跳转到 `/report/{实际scenarioId}`

### Requirement: turn_feedback 挂在用户消息上
attempt1 和 attempt2 的对话气泡列表中，`turn_feedback` SHALL 显示在用户消息气泡下方（而非 AI 消息气泡下方）。

#### Scenario: 对话后有反馈
- **WHEN** 一轮对话结束，AI 返回了 `turn_feedback`
- **THEN** 反馈维度标签和 short_comment 显示在该轮**用户**消息气泡下方

#### Scenario: 无反馈
- **WHEN** 该轮没有 `turn_feedback`
- **THEN** 用户气泡下方不显示反馈

### Requirement: 诊断文本含说话人标记
提交 `/api/attempt1/submit` 时，`attempt_text` SHALL 使用 `[user]: text\n[ai]: text` 格式，而非无角色标记的纯文本拼接。

#### Scenario: 提交诊断
- **WHEN** 用户点击"提交诊断"
- **THEN** `attempt_text` 格式为："[user]: Can I have a latte?\n[ai]: Sure, what size?\n[user]: Medium.\n..."

### Requirement: 报告展示进步对比
`report/[id]` 页的 `EvaluationContent` 组件 SHALL 同时展示 attempt1 分数、attempt2 分数和变化量（change）。

#### Scenario: 查看双轨评价
- **WHEN** 用户在报告页查看评价部分
- **THEN** 每个维度显示两条分数条（灰=A1，蓝=A2）和变化量（+0.5 / -0.3）
- 维度按变化量降序排列

### Requirement: 初次产出传递 audio_urls 供发音评分
`handleSubmit` 在提交 `/api/attempt1/submit` 时 SHALL 传递 `audio_urls` 字段。后端 SHALL 将 `audio_urls` 传递给 `evaluate_single` 的 `audio_paths` 参数，用于发音和流利度评分。

#### Scenario: 含音频提交
- **WHEN** 对话过程中至少有一条用户录音
- **THEN** `handleSubmit` 将 `audio_urls` 数组传给后端
- 后端 `evaluate_single` 收到 `audio_paths` 后进行 Whisper 词级分析

#### Scenario: 无音频（纯文本/降级）
- **WHEN** 没有用户录音（如 Mock 降级时）
- **THEN** `audio_urls` 传空数组或省略，发音评分使用默认值

## MODIFIED Requirements
无。

## REMOVED Requirements
无。
