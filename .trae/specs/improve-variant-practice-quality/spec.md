# 优化变体练习质量 Spec

## Why
二次产出（attempt2）的变体任务与初次产出偏离过大，AI 对话中存在死胡同回复和主题漂移问题，导致变体练习的教学效果和用户体验不达标。

## What Changes
- 优化 VLM `_SCENE_PROMPT`：将 variant_plot 从「实质差异」改为「同场景同角色、子任务类型变化、不超过一个交际维度改变」
- 优化 LLM `_REPLY_PROMPT`：新增三条行为约束规则，防止 AI 单向承诺型死胡同、反抛不推进、主题漂移
- 前端新增条件重试机制：当 AI 回复被判定为低质量时，显示「重新生成」按钮，替换最后一轮 AI 回复
- 前端新增 AI 回复质量判定逻辑：死胡同检测、连续反问检测、主题偏离检测

## Impact
- Affected specs: scenario generation, chat conversation quality
- Affected code:
  - `poa-backend/services/ai_service.py` — `_SCENE_PROMPT`
  - `poa-backend/services/chat_service.py` — `_REPLY_PROMPT`、`_OPENING_PROMPT`
  - `poa-frontend/src/app/attempt2/page.tsx` — 重试按钮 + 质量判定

## MODIFIED Requirements

### Requirement: 变体情节生成约束收紧
VLM 生成 variant_plot 时，SHALL 保持与主任务同一场景同一角色身份，仅改变子任务类型或交际目标，变体与主情节的差异不超过一个交际维度。

#### Scenario: 咖啡店场景变体生成
- **GIVEN** 主任务为咖啡店点单（ordering）
- **WHEN** VLM 生成变体情节
- **THEN** 变体应为咖啡店同一角色的不同子任务（如纠正错误订单、询问优惠），不得变成餐厅/机场等其他场景

#### Scenario: 变体差异控制
- **WHEN** VLM 生成 variant_plot
- **THEN** 变体不得引入超过 1 个新的交际维度变化（如仅改变子任务类型，不改变角色身份、不改变场景地点）

### Requirement: AI 对话行为约束增强
LLM 在 attempt2 对话中 SHALL 遵守以下新增行为规则，由 `_REPLY_PROMPT` 强制执行。

#### Scenario: 禁止单向承诺型回复
- **WHEN** AI 需要表达「去查询/请示/确认」等动作
- **THEN** AI 必须在同一轮回复中完成该动作并给出结果，或使用「非承诺式」表述，不得留下等待断点
- **EXAMPLE BAD**: "Let me go ask the store manager."（无下文）
- **EXAMPLE GOOD**: "According to our policy, we can offer you a 10% discount. Would that work for you?"

#### Scenario: 禁止连续反问不推进
- **WHEN** 学生已给出实质内容
- **THEN** AI 不得仅以反问回应（如 "And you?" / "What do you think?"），必须先回应学生内容，再自然引导下一轮
- **EXAMPLE BAD**: Student: "I want a latte." → AI: "And what size would you like?"（虽有关联但缺乏确认）
- **EXAMPLE GOOD**: Student: "I want a latte." → AI: "A latte, great choice. What size — small, medium, or large?"

#### Scenario: 禁止主题漂移
- **GIVEN** 任务有明确的 `variant_plot` 作为情节上下文
- **WHEN** AI 生成回复
- **THEN** AI 回复必须与 variant_plot 定义的情节方向一致，不得引入与变体任务无关的新话题

### Requirement: 前端条件重试机制
前端 SHALL 在检测到 AI 回复低质量时，显示「重新生成」按钮，点击后替换当前最后一轮 AI 回复并重新调用 `/api/chat/turn`。

#### Scenario: 死胡同回复触发重试按钮
- **GIVEN** AI 刚完成一轮回复
- **WHEN** 回复文本匹配死胡同模式（如含 "let me go ask" / "I'll check with" / "I need to confirm"）
- **THEN** 显示「重新生成回复」按钮

#### Scenario: 连续反问不推进触发重试按钮
- **GIVEN** AI 刚完成一轮回复，且上一轮 AI 回复也是纯反问
- **WHEN** 本轮回复仅含问句而无确认/回映内容
- **THEN** 显示「重新生成回复」按钮

#### Scenario: 主题偏离触发重试按钮
- **GIVEN** 任务有 variant_plot
- **WHEN** AI 回复与 variant_plot 关键词无任何语义交集（简单关键词匹配）
- **THEN** 显示「重新生成回复」按钮

#### Scenario: 重试替换行为
- **WHEN** 用户点击「重新生成回复」
- **THEN** 移除最后一轮 AI 回复，使用相同的 user_text 重新调用 `/api/chat/turn`，新回复替换旧回复位置

#### Scenario: 正常回复不显示重试按钮
- **WHEN** AI 回复未被任何低质量规则命中
- **THEN** 不显示重试按钮
