# Checklist

## DB & Schema（Task 1）
- [x] `poa-project/poa-backend/models.py` 中 `POATask` 新增 `opening_line: Column(Text, nullable=True)` 列
- [x] `poa-project/poa-backend/models.py` 中 `POATask` 新增 `closing_line: Column(Text, nullable=True)` 列
- [x] `poa-project/poa-backend/schemas.py` 中 `POATaskCreate` / `POATaskResponse` 新增 `opening_line: Optional[str]` 字段
- [x] `poa-project/poa-backend/schemas.py` 中 `POATaskCreate` / `POATaskResponse` 新增 `closing_line: Optional[str]` 字段

## VLM Prompt + analyze_scenario（Task 2）
- [x] `_SCENE_PROMPT` 第 113-134 行已重写，含 9 条关键要求（新增 opening_line / closing_line / 任务规模约束 / 场景化生活化）
- [x] JSON 输出 schema 同步更新：含 `opening_line` 和 `closing_line` 字段
- [x] `analyze_scenario()` 的 result dict 新增 `opening_line` 和 `closing_line` 键
- [x] `get_or_analyze_scenario()` cache hit 分支从 DB 读取 `t.opening_line` / `t.closing_line` 返回（不再为空串）
- [x] `get_or_analyze_scenario()` DB 写入路径把 `result["opening_line"]` / `result["closing_line"]` 写入 POATask 表
- [x] **修复** 原 `opening_question: ""` 残留 bug：cache hit 返回中 `opening_question` 字段替换为 `opening_line` 和 `closing_line`

## Chat 路由 + Service（Task 3）
- [x] `routers/chat.py` 中 `ChatStartRequest` 新增 `opening_line: str = ""` 字段
- [x] `routers/chat.py` 中 `ChatTurnRequest` 新增 `closing_line: str = ""` 字段
- [x] `chat_start` 路由：opening_line 非空时直接使用 + TTS，跳过 `generate_opening`
- [x] `chat_start` 路由：opening_line 为空时降级为 `generate_opening`
- [x] `chat_turn` 路由：把 `req.closing_line` 透传给 `generate_reply()` 的 `task_context`
- [x] `services/chat_service.py` 新增 `_match_closing_line(ai_text, closing_line) -> bool` 函数（SequenceMatcher 阈值 0.65）
- [x] `_match_closing_line` 在 closing_line 缺失时返回 False（不抛异常）
- [x] `generate_reply` 或 `_extract_completion_flag` 增加收尾语匹配分支：命中则 `is_final=True`
- [x] `services/chat_service.py` 新增 `request_closing_line(task_context) -> (ai_text, is_final)` 函数，构造 system hint 提示 AI 告别
- [x] 保留所有现有降级链路：`_mock_opening` / `_mock_reply` / `_extract_completion_flag` 兜底正则不变

## Attempt1 Plan A（Task 4）
- [x] `poa-project/poa-frontend/src/app/attempt1/page.tsx` 顶部新增 `WRAP_UP_HINT` 常量
- [x] 组件中新增 `wrappingUp: boolean` state
- [x] `recorder.onstop` 内：当 `turnLimitReached && !isFinal` 时进入 Plan A 分支
- [x] Plan A 分支：调用 chatTurn，请求体携带 `closing_line`（从 task）+ system hint（WRAP_UP_HINT 注入到 conversation_history 的 system 消息或 user_text 后缀）
- [x] Plan A chatTurn 返回后：把 AI 收尾回复加入 history；setIsFinal(true)
- [x] Plan A 调用失败（catch）时：降级为 setIsFinal(true) + 可选 console.warn
- [x] UI 表现：Plan A 调用期间录音按钮显示 "AI 正在收尾..." 文字 + disabled
- [x] 录音按钮在 `wrappingUp` 期间也禁用
- [x] 空格键 handler 在 `wrappingUp` 期间也早返回
- [x] 不破坏 attempt1 原有逻辑（AI 提前打标时仍能解锁提交）

## Attempt2 Plan A（Task 5）
- [x] `poa-project/poa-frontend/src/app/attempt2/page.tsx` 复用 Task 4 的 Plan A 实现
- [x] `ATTEMPT2_MAX_USER_TURNS = 4` 时正确触发 Plan A
- [x] 录音按钮 / 空格键 / beginRecord 在 `wrappingUp` 期间禁用
- [x] 不影响 attempt2 原有 variant_context / conversation 提交逻辑

## 端到端验证（Task 6）
- [x] 新图片场景：VLM 返回 `opening_line` 和 `closing_line` 字段非空、含场景专有词（VLM prompt + analyze_scenario 持久化代码确认）
- [x] 已有 cache 命中：返回的 `opening_line` / `closing_line` 不再为空（原 bug 修复，ai_service.py L312 已改为 `t.opening_line or ""`）
- [x] attempt1 跑 6 轮：第 7 次录音提交后自动触发 Plan A，AI 返回告别 + 提交按钮亮起（attempt1/page.tsx L416-470 Plan A 分支）
- [x] attempt2 跑 4 轮：第 5 次录音提交后自动触发 Plan A，效果一致（attempt2/page.tsx L500-574）
- [x] Plan A 调用 chatTurn 失败时降级为 setIsFinal(true)，流程不阻塞（catch 块内 fallbackText = closing_line || FALLBACK_CLOSING）
- [x] 旧任务（DB 中无 opening_line / closing_line）仍能正常工作：chatStart 降级 `generate_opening`，chatTurn 跳过收尾语匹配（_match_closing_line 在 closing_line 缺失时返回 False）
- [x] AI 提前打 `[CONVERSATION_COMPLETE]` 时仍能正常解锁提交（不触发 Plan A，因为 turnLimitReached 为 false 时不进 Plan A 分支）
- [x] `npm run build` 通过（exit code 0，13/13 路由生成成功），前端无 TypeScript 错误
- [ ] 收尾语匹配阈值 0.65 通过 unit test 验证（建议但不强制）
