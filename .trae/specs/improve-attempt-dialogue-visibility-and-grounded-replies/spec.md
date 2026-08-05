# 对话记录显隐与回复保真 Spec

## Why
当前尝试页会直接展示对话记录，用户缺少是否查看历史内容的主动控制。与此同时，AI 在多轮对话中频繁出现泛化回复，无法证明最新用户消息已经被稳定送达并参与云端推理。

## What Changes
- 在 `attempt1` 与 `attempt2` 页面引入“默认隐藏对话记录，用户主动选择后再展开”的交互
- 为对话链路增加可观测性，明确记录“前端采集文本、后端收到文本、送入模型文本、模型回复文本”的关键节点
- 调整后端回复生成规则，要求 AI 必须围绕用户最新一句和当前任务主题作出具体、贴题的回应
- 收紧泛化兜底回复的触发条件，避免 `"Let me check that for you"`、`"I don't catch that"` 一类脱题模板在正常输入下反复出现

## Impact
- Affected specs: attempt 对话交互、ASR/LLM 调用链路、对话历史可见性
- Affected code: `poa-frontend/src/app/attempt1/page.tsx`, `poa-frontend/src/app/attempt2/page.tsx`, `poa-backend/routers/chat.py`, `poa-backend/services/chat_service.py`, `poa-backend/services/asr_service.py`

## ADDED Requirements
### Requirement: 对话记录默认隐藏
系统 SHALL 在 `attempt1` 和 `attempt2` 页面默认隐藏历史对话记录区域，只有当用户主动选择查看时才展示。

#### Scenario: 默认进入页面
- **WHEN** 用户进入 `attempt1` 或 `attempt2` 页面且尚未点击“显示对话记录”
- **THEN** 页面不直接渲染历史对话记录列表
- **AND** 页面应保留明确的入口供用户主动展开对话记录

#### Scenario: 用户主动查看
- **WHEN** 用户点击“显示对话记录”或等价入口
- **THEN** 页面展示当前会话已有的历史对话记录
- **AND** 展示状态在本次会话中保持一致，直到用户再次主动隐藏或离开页面

### Requirement: 对话链路可观测
系统 SHALL 为每一轮对话记录关键链路证据，以验证“最新用户消息”是否确实进入模型推理。

#### Scenario: 一轮对话正常提交
- **WHEN** 用户结束一轮录音并触发对话提交
- **THEN** 系统应能够区分并记录以下关键数据：前端最终文本、服务端实际采用的用户文本、发送到模型的最后一轮用户消息、模型返回的原始回复
- **AND** 当回复明显脱题时，开发者可以通过日志快速判断问题出在 ASR、前后端传参、历史组装还是模型回复阶段

#### Scenario: 最新用户消息未被采用
- **WHEN** 服务端最终没有采用本轮用户最新消息
- **THEN** 系统应输出可诊断日志说明回退原因
- **AND** 不得在无诊断线索的情况下直接进入泛化模板回复

### Requirement: AI 回复必须贴合最新输入和任务主题
系统 SHALL 优先依据“用户最新一句 + 当前任务语境 + 既有对话历史”生成具体回复。

#### Scenario: 用户提出具体问题
- **WHEN** 用户就当前场景提出具体问题，例如口味、价格、推荐、下单顺序、任务要求相关内容
- **THEN** AI 回复应直接回应该问题中的核心信息点
- **AND** 回复应与当前任务主题一致
- **AND** 不得只返回泛化短句作为完整答复

#### Scenario: 用户继续多轮推进
- **WHEN** 用户在已有上下文上追加新问题或新请求
- **THEN** AI 回复应体现对上一轮上下文的连续理解
- **AND** 不得反复输出同一句固定模板

## MODIFIED Requirements
### Requirement: attempt 页面对话体验
系统 SHALL 将“字幕展示”和“历史对话记录展示”视为两类不同信息层级处理。字幕可按原有流程继续用于实时反馈，历史对话记录默认隐藏并由用户主动展开。

### Requirement: 对话生成兜底策略
系统 SHALL 仅在确认本轮用户输入不可用、任务上下文缺失或模型调用失败时才使用兜底策略。对于可识别的正常输入，系统必须优先返回具体、贴题的场景化回复。

## REMOVED Requirements
### Requirement: 历史对话默认直接展示
**Reason**: 当前默认展开会干扰主流程，且不符合用户“未主动选择时不要直接展示”的期望。
**Migration**: 保留历史记录数据结构，仅调整默认可见性与显隐交互。
