# 任务生成扩展（开场白+收尾语）+ 上限自动收尾 Spec

## Why
当前 POA 任务生成 VLM 仅输出 6 个标准字段（scene/roles/goal/context/evaluation/variant），**AI 开场白**仍由 chat service 在对话开始时实时生成（`generate_opening`），**AI 收尾语**根本没有显式产出。这导致两个体验问题：
1. **开场白不一致**：不同学生/不同时间问同一场景，AI 开场白可能漂移；且 prompt 中"引导性问题"权重不足，开场白常常泛化为 "Hello! How can I help you today?"
2. **收尾不可控**：上一轮 spec 加了"轮次上限兜底"，但只 setIsFinal，不通知 AI。当 AI 还在推进对话时戛然而止，学生感觉"对话未完成"；诊断样本里也缺一段**自然收束**，影响"语用策略得体性"维度评分。

需要把"开场白"和"收尾语"提升为任务的一等字段，由 VLM 在任务生成时一并产出（生活化、场景化、1 主目标 + ≤1 选子目标），并在上限到达时由系统自动调用 chatTurn 让 AI 完成最后告别。

## What Changes
- **新增** VLM 输出字段：`opening_line`（AI 开场白，需引导用户围绕话题开口）和 `closing_line`（AI 收尾语，说明完成任务主题事件后如何自然告别）
- **新增** DB 字段：`POATask.opening_line`、`POATask.closing_line`
- **修改** VLM prompt：明确"1 主目标 + ≤1 选子目标"、"场景化、生活化"、"开场白要引导用户开口"、"收尾语要体现场景特有告别方式"
- **修改** chatStart 路由：若请求携带 `opening_line`（来自 task），**直接使用**而不调用 LLM 重新生成
- **修改** chatTurn 路由：接收 `closing_line` 参数；chat_service 在解析 `is_final` 时**新增"语义匹配收尾语"分支**——若 AI 回复与 `closing_line` 相似度 ≥ 0.65（SequenceMatcher），同样视为对话结束
- **新增** 上限自动收尾（Plan A）：attempt1/attempt2 页面在达到轮次上限时，**不立即 setIsFinal**，而是**自动调用一次 chatTurn**，system 提示"对话已达轮次上限，请向用户自然告别"，等 AI 回复完再 setIsFinal(true)
- **修复** 缓存命中路径 bug：原代码 `get_or_analyze_scenario` 在 cache hit 时返回 `opening_question: ""`，导致已分析过的任务无法拿到开场白；改为从 DB 读取 `opening_line`/`closing_line`
- **保留** 现有降级链路：chat service 的 `_mock_opening` / `_mock_reply` 不变；Plan A 调用失败时**降级为通用告别模板**（"Thanks for chatting with me! Have a great day."），不阻塞用户

## Impact
- Affected specs: scenario, task-generation, chat, attempt1, attempt2
- Affected code:
  - `poa-project/poa-backend/services/ai_service.py` — **修改** `_SCENE_PROMPT`、**修改** `analyze_scenario()`、**修改** `get_or_analyze_scenario()` 的 cache hit 路径
  - `poa-project/poa-backend/models.py` — **新增** `POATask.opening_line` 和 `POATask.closing_line` 两列
  - `poa-project/poa-backend/schemas.py` — **新增** `POATaskCreate` / `POATaskResponse` 的 `opening_line` / `closing_line` 字段
  - `poa-project/poa-backend/routers/chat.py` — **修改** `ChatStartRequest` / `ChatTurnRequest` 增加 `opening_line` / `closing_line` 字段
  - `poa-project/poa-backend/services/chat_service.py` — **修改** `generate_opening` 支持优先使用传入的 `opening_line`；**修改** `_extract_completion_flag` 增加"语义匹配收尾语"分支；**新增** `request_closing_line(task_context)` 函数（Plan A 调用的 system 提示构造）
  - `poa-project/poa-frontend/src/app/attempt1/page.tsx` — **修改** `callChatTurn` / 录音 onstop 流程：上限到达时进入 Plan A 收尾流程
  - `poa-project/poa-frontend/src/app/attempt2/page.tsx` — 同上

## ADDED Requirements

### Requirement: VLM 生成场景化开场白
VLM 在任务生成时 SHALL 输出 `opening_line`：B 角色（AI 角色）的**第一句对话**，必须**引导用户围绕任务主题开口回答**（如询问"想要点什么？"、"有什么可以帮您的？"），且**禁止泛化开场白**（如 "Hello! How can I help you today?"）。开场白须使用场景专有词汇（如咖啡店提到 latte/espresso、机场提到 boarding gate）。

#### Scenario: 开场白通过
- **WHEN** VLM 完成任务 JSON 输出
- **THEN** `opening_line` 字段非空
- **AND** 包含至少 1 个场景专有词（latte / boarding gate / prescription 等）
- **AND** 包含明确的引导提问（? 结尾的问句或具体选项）

#### Scenario: 开场白降级
- **WHEN** VLM 输出的 `opening_line` 为空或与泛化模板高度相似（SequenceMatcher > 0.85）
- **THEN** chatStart 路由 SHALL 降级为 chat service 现有的 `generate_opening` LLM 调用

### Requirement: VLM 生成场景化收尾语
VLM 在任务生成时 SHALL 输出 `closing_line`：B 角色在**任务主题事件完成后**的自然告别句。必须使用**场景特有的告别方式**（咖啡店 "Enjoy your coffee!"、机场 "Have a safe flight!"、医院 "Take care and feel better soon!"），**禁止泛化**（"Goodbye!"、"See you!"）。

#### Scenario: 收尾语通过
- **WHEN** VLM 完成任务 JSON 输出
- **THEN** `closing_line` 字段非空
- **AND** 长度 ≤ 30 词
- **AND** 包含场景特有元素（"your coffee" / "your flight" / "your prescription" 等）

### Requirement: 任务规模约束
VLM SHALL 生成的每个任务 SHALL 包含 **1 个明确主目标 + ≤ 1 个可选子目标**。`goal` 字段 SHALL 体现主目标；`context_constraints` 可选地体现子目标。

#### Scenario: 任务规模合规
- **WHEN** 学生阅读 task 页面的 goal 字段
- **THEN** 应能清晰识别 1 个主目标（如"点一杯咖啡"）
- **AND** 最多 1 个可选子目标（如"询问会员卡"）
- **AND** 3-5 轮对话内可完成

### Requirement: 收尾语提前识别 is_final
chat service SHALL 在解析 AI 回复的 `is_final` 标记时，**额外比对 closing_line**。若 AI 回复（去除 `[CONVERSATION_COMPLETE]` 后）与 task 的 `closing_line` 的 SequenceMatcher 比对值 ≥ 0.65（不区分大小写），**同样视为对话结束**，前端 `is_final=true`。

#### Scenario: 收尾语匹配命中
- **WHEN** AI 回复 "Enjoy your latte! Have a great day."
- **AND** task 的 `closing_line` = "Enjoy your coffee! Have a great day."
- **THEN** SequenceMatcher 比对 ≥ 0.65（"enjoy your" / "have a great day" 重复）
- **AND** chatTurn 路由返回 `is_final=true`
- **AND** 前端提交按钮亮起

#### Scenario: 收尾语匹配未命中
- **WHEN** AI 回复 "Sure, what size would you like?"
- **AND** task 的 `closing_line` = "Enjoy your coffee! Have a great day."
- **THEN** SequenceMatcher 比对 < 0.30
- **AND** 不影响 is_final 判定（仅依赖 `[CONVERSATION_COMPLETE]` 标记）

#### Scenario: closing_line 缺失
- **WHEN** 旧任务（DB 迁移前）在 chatTurn 请求中**未传** closing_line
- **THEN** chat service SHALL 跳过收尾语匹配分支（不影响原有 `[CONVERSATION_COMPLETE]` 解析）

### Requirement: 上限到达自动收尾（Plan A）
attempt1 / attempt2 页面 SHALL 在 user 发言达到上限时，**不立即 setIsFinal(true)**，而是**自动调用一次 chatTurn**，system 提示注入 "对话已达轮次上限，请向用户自然告别并打 [CONVERSATION_COMPLETE] 标记"，等 AI 回复后**再 setIsFinal(true)** 并解锁提交。

#### Scenario: Plan A 正常路径
- **WHEN** attempt1 第 6 轮 user 录音提交后
- **AND** AI 在第 6 轮尚未说告别
- **THEN** 前端 SHALL 自动发起一次 chatTurn（请求体携带 task closing_line 作为收敛信号）
- **AND** UI 在 chatTurn 返回前显示 "AI 正在收尾..." loading
- **AND** chatTurn 返回后，AI 的告别回复加入 history
- **AND** setIsFinal(true) + 提交按钮亮起 + 显示"已达到建议轮次"标签

#### Scenario: Plan A 降级
- **WHEN** Plan A 的 chatTurn 调用失败（超时/网络错误/LLM 限流）
- **THEN** 前端 SHALL 直接 setIsFinal(true) + 显示通用告别 "Thanks for chatting! Have a great day."
- **AND** 不阻塞用户提交

#### Scenario: AI 提前结束
- **WHEN** userTurnCount < MAX 但 AI 已打 `[CONVERSATION_COMPLETE]`
- **THEN** 维持现有"isFinal 立即解锁"行为（不触发 Plan A）

## MODIFIED Requirements

### Requirement: `_SCENE_PROMPT` VLM prompt
原 7 条关键要求扩展为 9 条，并强化场景化/生活化/规模约束约束。

**原 prompt 关键要求（第 113-134 行）：**
> 1. scene_label
> 2. roles
> 3. goal
> 4. context_constraints
> 5. evaluation_criteria
> 6. variant_plot
> 7. opening_question
> + 交际类型多样性
> + 输出要求 JSON

**新 prompt 关键要求（替换为以下内容）：**
> 1. scene_label — 场景专有名称
> 2. roles — 明确两个角色及其身份
> 3. goal — 1 个明确主目标（含 1-2 个产出标准）
> 4. context_constraints — 场景特有约束（时间/顾客特征/意外状况）
> 5. evaluation_criteria — 3~5 条具体维度（禁止通用维度）
> 6. variant_plot — 同一场景不同情节变体
> 7. **opening_line** — B 角色的第一句开场白，必须包含场景专有词 + 引导提问（如 "What brings you in today?" / "Hi! Are you here for a check-up?"），**禁止泛化**（"Hello! How can I help you?"）
> 8. **closing_line** — B 角色在主目标达成后的自然告别句，**必须使用场景特有告别**（"Enjoy your coffee!" / "Have a safe flight!" / "Take care, and feel better soon!"），**禁止泛化**（"Goodbye!" / "See you!"），≤ 30 词
> 9. **任务规模约束** — 整个对话 1 主目标 + ≤ 1 选子目标，3-5 轮可完成；不要设计复杂多目标/多层情节
> + **场景化生活化要求** — 必须使用真实生活场景（咖啡店/医院/机场/图书馆等），禁止抽象/虚构场景；场景元素（产品/服务/地点）必须具体可感

输出 JSON schema 同步更新：
```json
{
  "scene_label": "...",
  "poa_task": {
    "roles": "...",
    "goal": "...",
    "context_constraints": "...",
    "evaluation_criteria": ["维度1", "维度2", "维度3"]
  },
  "variant_plot": "...",
  "opening_line": "B 角色的第一句开场白（场景化 + 引导提问）",
  "closing_line": "B 角色的场景化告别（≤30 词）"
}
```

### Requirement: `POATask` ORM 模型
`POATask` 表 SHALL 新增 2 列：
- `opening_line: Column(Text, nullable=True)` — AI 开场白
- `closing_line: Column(Text, nullable=True)` — AI 收尾语

**重要**：DB 迁移通过 SQLAlchemy `create_all` 自动建表（新部署）或人工 ALTER TABLE（已有库）；spec 不强制要求 Alembic。

### Requirement: `chatStart` 路由优先使用 `opening_line`
`POST /api/chat/start` SHALL 在请求体携带 `opening_line` 时**直接使用**（跳过 `generate_opening` LLM 调用与 TTS 文本生成），并对其做 TTS 合成。若 `opening_line` 为空，**降级**为现有 `generate_opening` 行为。

#### Scenario: opening_line 优先
- **WHEN** 请求体 `opening_line` 非空字符串
- **THEN** 路由 SHALL 直接返回 `{ai_text: opening_line, ai_audio_url: text_to_speech(opening_line)}`
- **AND** 不调用 `generate_opening`

#### Scenario: opening_line 缺失
- **WHEN** 请求体 `opening_line` 为空
- **THEN** 路由 SHALL 调用 `generate_opening`（现有行为）

### Requirement: `analyze_scenario` 持久化
`ai_service.analyze_scenario()` SHALL 把 `opening_line` / `closing_line` 写入 DB `POATask` 表。`get_or_analyze_scenario()` 的 cache hit 分支 SHALL 从 DB 读取 `opening_line` / `closing_line` 并返回（**修复**原 `opening_question: ""` 的 bug）。

## REMOVED Requirements

### Requirement: 旧 `opening_question` 字段
**Reason**：VLM 输出字段从 `opening_question` 改名为 `opening_line`（更准确地表达"完整开场白"而非仅"引导性问题"），且持久化到 DB；前端无须再传 `opening_question`。
**Migration**：前端 task 页面读取 `opening_line` 替代 `opening_question`；API response 同时返回新旧两个字段以兼容（旧字段映射为 `opening_line`）。

## 设计权衡记录

| 决策 | 备选 | 选用理由 |
|------|------|----------|
| VLM 同时生成 opening_line 和 closing_line（不依赖 chat service 实时生成） | chat service 实时生成开场白 + 收尾语 | 任务级一致性（同场景每次练习开场白相同），降低运行时 LLM 调用，确定性高 |
| Plan A 收尾用 chatTurn 实时调用，不用预生成 closing_line | 用预生成的 closing_line 直接 setIsFinal | 实时调用能结合实际对话上下文（如用户已说了"谢谢"），告别更自然；预生成可能与实际进度脱节 |
| 收尾语提前识别用 SequenceMatcher 阈值 0.65 | 严格相等 / embedding 相似度 | SequenceMatcher 零依赖、轻量；阈值 0.65 能匹配"enjoy your coffee" vs "enjoy your latte"这种部分重合的告别变体；embedding 需引入额外模型，过重 |
| 收尾语匹配作为 is_final 的"或"分支，不替换原 `[CONVERSATION_COMPLETE]` 检测 | 用收尾语匹配替换标记检测 | 标记检测仍是最强信号（LLM 主动承诺结束）；收尾语匹配是"AI 不打标记但语义已收束"时的兜底 |
| Plan A 调用失败时降级为通用告别模板 | 阻塞用户 / 强制提交 | 不阻塞体验；通用告别作为最后防线 |
| opening_line 缺失时降级到 `generate_opening` LLM 调用 | 报错 / 用空串 | 旧任务兼容；空开场白体验差 |
| 任务规模 1+≤1（不强制 1+1） | 1+0（仅主目标）/ 1+2 | 1+≤1 给 VLM 灵活度（简单任务可仅 1+0），但禁止复杂多目标；3-5 轮是合理完成时间 |

## 验收标准

- [ ] DB `POATask` 表新增 `opening_line` 和 `closing_line` 两列
- [ ] Pydantic `POATaskCreate` / `POATaskResponse` 含 `opening_line` / `closing_line` 字段
- [ ] VLM prompt 重写：含 `opening_line` / `closing_line` / 任务规模约束 / 场景化生活化要求
- [ ] `analyze_scenario()` 解析 VLM 输出并存入 DB
- [ ] `get_or_analyze_scenario()` cache hit 路径返回 `opening_line` / `closing_line`（修复空串 bug）
- [ ] `chatStart` 路由优先使用请求体 `opening_line`，缺失时降级 `generate_opening`
- [ ] chat service `_extract_completion_flag`（或新增函数）支持收尾语 SequenceMatcher 匹配
- [ ] attempt1 在第 6 轮 user 提交后自动触发 Plan A：调用 chatTurn → 展示收尾 → setIsFinal
- [ ] attempt2 在第 4 轮 user 提交后自动触发 Plan A（同 attempt1 逻辑）
- [ ] Plan A 调用失败时降级为通用告别模板，不阻塞用户
- [ ] 旧任务（无 opening_line / closing_line）仍可正常工作
- [ ] 保留所有现有降级链路（`_mock_opening` / `_mock_reply` / `is_final` 兜底正则）
- [ ] `npm run build` 通过，前端无 TypeScript 错误
