# 对话结束机制加固 + 客户端轮次兜底 Spec

## Why
当前 attempt1 / attempt2 阶段的 AI 对话存在两个稳定性风险：
1. **AI 漏标**：`[CONVERSATION_COMPLETE]` 标记完全依赖 LLM 在 7 条规则中"自觉"输出，规则混排在 system prompt 中权重不足，实测中 AI 经常忘记打标记或输出变体（如 `[END]`、`[conversation ended]`、`***end***`），导致 `is_final` 长期为 false，前端"提交诊断/验证"按钮一直无法亮起。
2. **无轮次上限**：当前仅检查下限 `history.length < 2`，无上限。极端情况下用户可与 AI 无限交流，导致：(a) LLM/TTS 成本不可控；(b) POA "暴露 gap" 理念被稀释——对话越长用户越倾向"边说边改"，反而掩盖 gap；(c) 演示中容易"聊了很久还没结束"，节奏失控。

需要在不破坏现有降级链路（Mock 回复、`is_final` 兜底正则、客户端 hard-cap 录音时长）的前提下，用最小改动把这两点补上。

## What Changes
- **加固** AI 结束判断：将 `_REPLY_PROMPT` 规则 #6 的"自由发挥式"指令，重写为**可执行 3 条 checklist**（子目标全部达成 + 双方已告别 + 没有未解决问题），并强化"必须 / 禁止"语气
- **新增** 客户端轮次上限常量：`ATTEMPT1_MAX_USER_TURNS=6`, `ATTEMPT2_MAX_USER_TURNS=4`，下限保留 `MIN_USER_TURNS=2`
- **新增** 客户端轮次计数与禁用：当 user 发言达到上限时，自动 `setIsFinal(true)`、禁用录音按钮与空格键、亮起"提交诊断/验证"按钮
- **新增** UI 提示：达到上限后在按钮旁显示"已达到建议轮次"小标签
- **保留** 现有降级链路（Mock `_mock_reply` 返回的强结束语 `_extract_completion_flag` 兜底正则不变）

## Impact
- Affected specs: chat, attempt1, attempt2
- Affected code:
  - `poa-project/poa-backend/services/chat_service.py` — 重写 `_REPLY_PROMPT` 规则 #6 为可执行 checklist
  - `poa-project/poa-frontend/src/app/attempt1/page.tsx` — 新增轮次常量、计数、禁用逻辑、UI 标签
  - `poa-project/poa-frontend/src/app/attempt2/page.tsx` — 同上（使用 attempt2 的常量值）

## ADDED Requirements

### Requirement: AI 结束对话判定（Checklist 化）
AI 在每轮回复中 SHALL 依据一个 3 条可执行 checklist 决定是否结束对话。**仅当 3 条全部为 true 时**，AI MUST 在回复末尾追加**且仅追加** `[CONVERSATION_COMPLETE]` 标记；任一条为 false 时 MUST NOT 追加。

#### Scenario: 全部子目标达成
- **WHEN** 场景的所有交际子目标已完成（如咖啡店场景：点单 + 杯型 + 温度 + 是否加餐均已确认）
- **AND** AI 已给出自然告别（如 "Enjoy your coffee!"）
- **AND** 学生最后一句无未解决问题
- **THEN** AI 回复末尾 MUST 追加 `[CONVERSATION_COMPLETE]`
- **AND** 后端 `_extract_completion_flag` 解析后 `is_final=True`
- **AND** 前端"提交诊断"按钮亮起

#### Scenario: 仍有未解决子目标
- **WHEN** 学生点单后 AI 询问"Hot or iced?"，但学生尚未回答
- **THEN** AI MUST NOT 追加 `[CONVERSATION_COMPLETE]`
- **AND** AI 应继续推进对话

#### Scenario: 标记格式校验
- **WHEN** AI 输出任意变体（如 `[END]`、`[conversation ended]`、`***end***`）
- **THEN** 后端 MUST NOT 误判为结束（仅识别 `[CONVERSATION_COMPLETE]` 大小写变体）
- **AND** 客户端轮次兜底 SHALL 接管判断

### Requirement: Attempt1 客户端轮次上限
Attempt1 页面 SHALL 在用户发言数达到 `ATTEMPT1_MAX_USER_TURNS=6` 时自动结束对话并解锁提交。

#### Scenario: 达到上限
- **WHEN** `userTurnCount === 6`（即 `history.filter(h => h.role === "user").length === 6`）
- **THEN** 前端 SHALL `setIsFinal(true)`（无论 AI 是否已打标记）
- **AND** 录音按钮 MUST 禁用（视觉变灰 + 不可点击）
- **AND** 空格键长按录音 MUST 禁用
- **AND** "提交诊断"按钮 MUST 亮起（已有 isFinal 联动）
- **AND** 按钮旁显示"已达到建议轮次"标签

#### Scenario: 未达下限
- **WHEN** 用户在 `userTurnCount < 2` 时点击"提交诊断"
- **THEN** 维持现有 alert"请至少进行一轮对话"提示（行为不变）

#### Scenario: AI 提前结束
- **WHEN** AI 在 `userTurnCount < 6` 时已打 `[CONVERSATION_COMPLETE]`
- **THEN** 维持现有"按 isFinal 提前解锁"行为（用户可选择立即提交）

### Requirement: Attempt2 客户端轮次上限
Attempt2 页面 SHALL 复用同一套机制，但上限为 `ATTEMPT2_MAX_USER_TURNS=4`（变体任务更短更聚焦）。

#### Scenario: Attempt2 达到上限
- **WHEN** `userTurnCount === 4`
- **THEN** 同 Attempt1：禁用录音、亮起"提交验证"按钮、显示标签

## MODIFIED Requirements

### Requirement: `_REPLY_PROMPT` 规则 #6（结束对话）
原规则 #6 是一段"自然语言自由发挥"指令，现重写为可执行 checklist 风格：

**原内容（chat_service.py 第 56-60 行）：**
> 6. END THE CONVERSATION
> When the communicative task is naturally complete (all goals achieved, farewell exchanged), append the exact marker [CONVERSATION_COMPLETE] to the END of your reply.

**新内容：**
> 6. END THE CONVERSATION (MANDATORY 3-STEP CHECKLIST)
> Before ending, evaluate ALL THREE checks. The conversation ends **if and only if all 3 are true**:
>   ✓ Check 1 — ALL communicative sub-goals are achieved (e.g., for a cafe scene: drink + size + temperature + add-ons all confirmed)
>   ✓ Check 2 — A natural farewell has been exchanged by both sides (you said goodbye/“enjoy your…” and the student accepted it)
>   ✓ Check 3 — There is NO unresolved question or pending request from the student
> **If all 3 = TRUE**: append the EXACT marker `[CONVERSATION_COMPLETE]` to the very END of your reply, AFTER a natural farewell sentence.
> **If any = FALSE**: DO NOT append the marker. Continue the conversation naturally.
> **NEVER** use variants like `[END]`, `[conversation ended]`, `***end***`. The exact string `[CONVERSATION_COMPLETE]` is required.
> Example end: "Enjoy your latte! Have a great day. [CONVERSATION_COMPLETE]"
> Example continue: "What size would you like — small, medium, or large?"

其他规则（#1-#5、#7）维持不变。

### Requirement: Attempt1 录音可达性
Attempt1 页面 SHALL 在以下两个条件**任一**为 true 时禁用录音：(a) `isFinal` 已为 true（AI 自然结束）；(b) `userTurnCount >= ATTEMPT1_MAX_USER_TURNS`（客户端兜底）。

#### Scenario: 禁用状态
- **WHEN** `isFinal || userTurnCount >= 6`
- **THEN** 录音按钮 `disabled` 属性为 true
- **AND** 空格键 handler 提前 return
- **AND** 按钮显示禁用样式（变灰 + cursor-not-allowed）

### Requirement: Attempt2 录音可达性
Attempt2 页面 SHALL 复用 Attempt1 的禁用条件，阈值改为 `userTurnCount >= 4`。

## 设计权衡记录

| 决策 | 备选 | 选用理由 |
|------|------|----------|
| 只做前端兜底（不做后端强校验） | 也加后端 max_turns 校验 | 改动最小；C 方案本质是 UX 兜底，不是安全边界；后端 chat.py 路由改动会牵涉 evaluate 等下游 |
| Checklist 而非 few-shot | few-shot 示例 | Checklist 是结构化指令，LLM 漏执行率更低；few-shot 会显著增加 token 成本 |
| 达到上限 = 立即 `isFinal=true`（不弹模态框） | 弹模态框让用户确认 | POA 流程节奏优先；用户可主动点提交；不强制自动提交避免数据丢失 |
| 上限值 attempt1=6, attempt2=4 | 统一 6 / 宽松 8+6 | 兼顾 POA gap 暴露充分性 + LLM 成本 + 演示节奏；attempt2 任务更短，4 轮足够 |
| 维持现有 `is_final` 兜底正则 | 删除兜底 | 删了会破坏 Mock 降级链路；保留零成本 |

## 验收标准

- [ ] 后端 `_REPLY_PROMPT` 第 6 条已重写为 3 条 checklist
- [ ] attempt1 页面常量 `ATTEMPT1_MAX_USER_TURNS=6`, `MIN_USER_TURNS=2`
- [ ] attempt1 在第 6 轮 user 发言后：录音禁用 + 提交按钮亮起 + 标签出现
- [ ] attempt1 在第 1 轮 user 发言时点提交：弹 alert（行为不变）
- [ ] attempt1 在 AI 提前打标时：按 isFinal 解锁（行为不变）
- [ ] attempt2 页面常量 `ATTEMPT2_MAX_USER_TURNS=4`
- [ ] attempt2 在第 4 轮 user 发言后：录音禁用 + 提交按钮亮起 + 标签出现
- [ ] 不破坏 Mock 降级链路：LLM 失败时仍能跑通
- [ ] 不影响 attempt1 → diagnose、attempt2 → evaluate 跳转
