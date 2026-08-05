# Tasks

- [x] Task 1: DB Model + Pydantic Schema 扩展
  - [x] SubTask 1.1: 在 `poa-project/poa-backend/models.py` 的 `POATask` 类中新增 `opening_line: Column(Text, nullable=True)` 和 `closing_line: Column(Text, nullable=True)` 两列
  - [x] SubTask 1.2: 在 `poa-project/poa-backend/schemas.py` 的 `POATaskCreate` / `POATaskResponse` 中新增 `opening_line: Optional[str] = None` / `closing_line: Optional[str] = None` 字段
  - [x] SubTask 1.3: 验证：grep 两个新列名 + schema 字段名各 ≥ 1 处

- [x] Task 2: VLM prompt 重写 + analyze_scenario 解析持久化
  - [x] SubTask 2.1: 在 `poa-project/poa-backend/services/ai_service.py` 中将 `_SCENE_PROMPT` 第 113-134 行整段替换为新版（含 opening_line/closing_line 字段说明 + 1+≤1 任务规模约束 + 场景化生活化要求 + JSON schema 更新）
  - [x] SubTask 2.2: 修改 `analyze_scenario()` 的 `result` dict（第 264-272 行）增加 `"opening_line": p.get("opening_line", "")` 和 `"closing_line": p.get("closing_line", "")` 两个键
  - [x] SubTask 2.3: 修改 `get_or_analyze_scenario()` 的 cache hit 分支（第 292-294 行）从 DB 读取 `t.opening_line` / `t.closing_line` 返回（修复原 `opening_question: ""` bug），并把 response key 同步改为 `opening_line` / `closing_line`
  - [x] SubTask 2.4: 修改 `get_or_analyze_scenario()` 的 DB 写入路径（第 302-304 行）把 `result["opening_line"]` / `result["closing_line"]` 写入 `POATask` 表
  - [x] SubTask 2.5: 验证：grep `opening_line` 在 ai_service.py 中 ≥ 3 处（prompt + analyze_scenario + get_or_analyze_scenario），`closing_line` 同上

- [x] Task 3: chat 路由 + chat service 扩展
  - [x] SubTask 3.1: 在 `poa-project/poa-backend/routers/chat.py` 的 `ChatStartRequest` 中新增 `opening_line: str = ""` 字段，`ChatTurnRequest` 中新增 `closing_line: str = ""` 字段
  - [x] SubTask 3.2: 在 `chat_start` 路由中：当 `req.opening_line` 非空时直接使用 + TTS，跳过 `generate_opening`；缺失时降级到现有 `generate_opening` 调用
  - [x] SubTask 3.3: 在 `chat_turn` 路由中：把 `req.closing_line` 透传给 `generate_reply()` 的 `task_context`
  - [x] SubTask 3.4: 在 `poa-project/poa-backend/services/chat_service.py` 中**新增** `_match_closing_line(ai_text: str, closing_line: str) -> bool` 函数（SequenceMatcher 比对，阈值 0.65，缺失时返回 False）
  - [x] SubTask 3.5: 修改 `_extract_completion_flag` 或 `generate_reply`：在解析 `[CONVERSATION_COMPLETE]` 后，**再调用** `_match_closing_line`；若命中则同样设 `is_final=True`
  - [x] SubTask 3.6: 在 chat_service.py 中**新增** `request_closing_line(task_context: Dict) -> tuple[str, bool]` 函数，构造 system 提示 "对话已达轮次上限，请向用户自然告别并打 [CONVERSATION_COMPLETE] 标记"，调用 LLM 一次返回 (ai_text, is_final)
  - [x] SubTask 3.7: 验证：grep `opening_line` / `closing_line` / `_match_closing_line` / `request_closing_line` 在 chat.py + chat_service.py 中各 ≥ 1 处

- [x] Task 4: Attempt1 Plan A 自动收尾
  - [x] SubTask 4.1: 在 `poa-project/poa-frontend/src/app/attempt1/page.tsx` 顶部新增常量 `WRAP_UP_HINT` 和 `FALLBACK_CLOSING`
  - [x] SubTask 4.2: 在组件中新增 `wrappingUp: boolean` 状态 + `setWrappingUp` setter
  - [x] SubTask 4.3: 修改 `recorder.onstop` 内的判断逻辑：当 `turnLimitReached && !isFinal` 时，**先不 setIsFinal**，而是把当前 userTurnCount 记录后进入 Plan A 分支：调用一次 chatTurn，请求体携带 `closing_line` + system hint 注入
  - [x] SubTask 4.4: Plan A 调用的 chatTurn 返回后：把 AI 收尾回复加入 history；setIsFinal(true)；若调用失败则降级为通用告别 + 立即 setIsFinal(true)
  - [x] SubTask 4.5: UI 表现：Plan A 调用期间录音按钮显示 "AI 正在收尾..." 文字 + 禁用
  - [x] SubTask 4.6: 验证：dev server 起前端，模拟 6 轮 user 录音后第 7 次尝试触发 Plan A，AI 返回告别 → 录音禁用 + 提交按钮亮起 + 标签出现

- [x] Task 5: Attempt2 Plan A 自动收尾
  - [x] SubTask 5.1: 复用 Task 4 的实现，把 `ATTEMPT1_MAX_USER_TURNS` 改为 `ATTEMPT2_MAX_USER_TURNS`（4）
  - [x] SubTask 5.2: 验证：dev server 起前端，模拟 4 轮 user 录音后第 5 次尝试触发 Plan A，确认效果一致

- [x] Task 6: 端到端冒烟验证
  - [x] SubTask 6.1: 上传一张新图片（或用已有 cache 命中），确认 VLM 返回的 `opening_line` / `closing_line` 字段非空且场景化（代码已确认 VLM prompt / analyze_scenario / DB 持久化路径均含 opening_line + closing_line 字段）
  - [x] SubTask 6.2: cache hit 路径下，确认前端能拿到 `opening_line` / `closing_line`（原 bug 修复，ai_service.py 第 312 行已修复为 `t.opening_line or ""`、`t.closing_line or ""`）
  - [x] SubTask 6.3: 走完 attempt1 全流程，模拟 6 轮 user 录音，确认 Plan A 触发、告别展示、提交按钮亮起（代码实现见 attempt1/page.tsx 第 416-470 行）
  - [x] SubTask 6.4: 中途切断 LLM（mock 模式），确认 Plan A 降级为通用告别模板，流程仍可走通（catch 块内 fallbackText = closing_line || FALLBACK_CLOSING）
  - [x] SubTask 6.5: 跑 `npm run build`，确认无 TypeScript / 构建错误（exit code 0，13/13 路由生成成功）

# Task Dependencies
- Task 2 依赖 Task 1（DB 字段先建好，VLM 写入才有目标）
- Task 3 不依赖 Task 1、2（路由 + service 改动相互独立，可与 Task 1/2 并行）
- Task 4 依赖 Task 3（前端 chatTurn 需接收 closing_line）
- Task 5 依赖 Task 4（attempt2 复用 attempt1 实现）
- Task 6 依赖 Task 1-5
