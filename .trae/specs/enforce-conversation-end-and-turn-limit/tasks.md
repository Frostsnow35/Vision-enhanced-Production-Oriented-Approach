# Tasks

- [x] Task 1: 后端 `_REPLY_PROMPT` 规则 #6 重写为可执行 Checklist
  - [x] SubTask 1.1: 在 `poa-project/poa-backend/services/chat_service.py` 中将 `_REPLY_PROMPT` 规则 #6 整段替换为 3 条 checklist 风格指令
  - [x] SubTask 1.2: 保留规则 #1-#5、#7 原文不变
  - [x] SubTask 1.3: 确认 `_extract_completion_flag` 仍只识别 `[CONVERSATION_COMPLETE]` 大小写变体，不识别 `[END]` 等变体
  - [x] SubTask 1.4: 验证：grep 三个 Check 关键词全部命中，规则 #1-#5、#7 原文未动

- [x] Task 2: Attempt1 页面轮次上限逻辑
  - [x] SubTask 2.1: 在 `poa-project/poa-frontend/src/app/attempt1/page.tsx` 顶部新增常量 `ATTEMPT1_MAX_USER_TURNS = 6`、`MIN_USER_TURNS = 2`
  - [x] SubTask 2.2: 从 `history` 派生 `userTurnCount = history.filter(h => h.role === "user").length`
  - [x] SubTask 2.3: 在 `recorder.onstop` 内、调用 `callChatTurn` 之前增加判断：若 `turnLimitReached && !isFinal`，则 `setIsFinal(true)` 并 console.info 一条信息
  - [x] SubTask 2.4: 录音按钮 `disabled={!canRecord}`（合并 micReady && !uploading && !isFinal && !turnLimitReached）
  - [x] SubTask 2.5: 在 `beginRecord` 第一行加 `if (!canRecord) return;`（防御空格键路径）
  - [x] SubTask 2.6: 在"提交诊断"按钮旁新增条件渲染 `<span>`"已达到建议轮次"标签
  - [x] SubTask 2.7: TDZ 修复：将 `micReady` / `canRecord` 上移到 `beginRecord` 之前；删除 Render 区的重复声明

- [x] Task 3: Attempt2 页面轮次上限逻辑（复用 Task 2 模式）
  - [x] SubTask 3.1: 在 `poa-project/poa-frontend/src/app/attempt2/page.tsx` 顶部新增常量 `ATTEMPT2_MAX_USER_TURNS = 4`、`MIN_USER_TURNS = 2`
  - [x] SubTask 3.2: 复用 Task 2.2-2.6 的实现，把 `ATTEMPT1_MAX_USER_TURNS` 改为 `ATTEMPT2_MAX_USER_TURNS`
  - [x] SubTask 3.3: 验证：dev server 起前端，模拟 user 连续 4 次提交录音，确认第 4 次后录音按钮变灰 + 提交按钮亮起

- [x] Task 4: 端到端冒烟验证
  - [x] SubTask 4.1: 启动后端 + 前端，从 /scenario 走完 attempt1 全流程，确认 6 轮上限生效
  - [x] SubTask 4.2: 走完 facilitate → attempt2，确认 4 轮上限生效
  - [x] SubTask 4.3: 中途切断 LLM（mock 模式），确认降级链路仍可走通（Mock `_mock_reply` 返回告别语时 `is_final=true`）
  - [x] SubTask 4.4: 跑 `npm run build`，确认无 TypeScript / 构建错误（exit code 0，13/13 路由生成成功）

# Task Dependencies
- Task 2 不依赖 Task 1（可并行；后端 prompt 改动与前端轮次逻辑相互独立）
- Task 3 不依赖 Task 1、不依赖 Task 2（可与 Task 2 并行；attempt2 与 attempt1 文件独立）
- Task 4 依赖 Task 1、Task 2、Task 3
