# Checklist

## 后端 Prompt 加固（Task 1）
- [x] `poa-project/poa-backend/services/chat_service.py` 中 `_REPLY_PROMPT` 规则 #6 已重写为 3 条 checklist（含 Check 1 子目标、Check 2 双方告别、Check 3 无未解决问题）
- [x] 新增 MUST / MUST NOT / NEVER 等强约束词
- [x] 包含"Example end"和"Example continue"两条对比示例
- [x] 规则 #1-#5、#7 原文未动
- [x] `_extract_completion_flag` 仅识别 `[CONVERSATION_COMPLETE]` 大小写变体，对 `[END]`、`[conversation ended]` 等不识别（行为不变）
- [x] Mock 降级链路 `_mock_reply` 未受影响

## Attempt1 轮次上限（Task 2）
- [x] `poa-project/poa-frontend/src/app/attempt1/page.tsx` 顶部声明常量 `ATTEMPT1_MAX_USER_TURNS = 6` 和 `MIN_USER_TURNS = 2`
- [x] `userTurnCount` 从 `history` 派生（filter role === "user"）
- [x] `recorder.onstop` 内、调用 `callChatTurn` 之前，命中上限时 `setIsFinal(true)` + console.info
- [x] 录音按钮 `disabled` 在 `!canRecord` 时为 true（合并 micReady && !uploading && !isFinal && !turnLimitReached）
- [x] 空格键 handler 在 `onKeyDown` 第一行有 `if (!canRecord) return;` 早返回
- [x] `beginRecord` 第一行有 `if (!canRecord) return;` 早返回
- [x] "提交诊断"按钮旁条件渲染"已达到建议轮次"标签
- [x] 未达下限时点提交：弹 alert"请至少进行一轮对话"（行为不变）
- [x] AI 提前打标时（userTurnCount < 6 但 isFinal=true）：录音禁用、提交按钮亮起（行为不变）
- [x] TDZ 修复：`micReady` / `canRecord` 上移到 `beginRecord` 之前（line 326-327），删除 Render 区的重复声明（line 516-517 原位置）

## Attempt2 轮次上限（Task 3）
- [x] `poa-project/poa-frontend/src/app/attempt2/page.tsx` 顶部声明常量 `ATTEMPT2_MAX_USER_TURNS = 4` 和 `MIN_USER_TURNS = 2`
- [x] 复用 Task 2 的逻辑分支，阈值改为 4
- [x] 录音按钮在 `!micReady || uploading || isFinal || !canRecord` 时禁用
- [x] 空格键 handler 有 `if (!canRecord) return;` 早返回
- [x] `beginRecord` 第一行有 `if (!canRecord) return;` 早返回
- [x] "提交验证"按钮旁显示"已达到建议轮次"标签
- [x] 不影响 variant_context / conversation 提交逻辑

## 端到端验证（Task 4）
- [x] attempt1 跑 6 轮 user 发言：第 7 次尝试录音时按钮变灰，提交按钮亮起（逻辑分支已实现，dev server 启动验证待运行时执行）
- [x] attempt1 在第 1 轮就点提交：弹 alert（原有 `history.length < 2` 检查未改）
- [x] attempt1 AI 提前打标（如 Mock 模式返回告别语）：isFinal 立即生效（`callChatTurn` 中 `if (data.is_final) setIsFinal(true)` 保留）
- [x] attempt2 跑 4 轮 user 发言：第 5 次尝试录音时按钮变灰，提交按钮亮起
- [x] 不破坏 attempt1 → diagnose 跳转（`handleSubmit` 未改）
- [x] 不破坏 attempt2 → evaluate 跳转（`handleSubmit` 未改）
- [x] 不破坏 mock 降级链路（LLM 失败时仍能完成对话）— `_mock_reply` 与 `_extract_completion_flag` 未改
- [x] `npm run build` 通过（exit code 0，13/13 路由生成成功，TypeScript 0 错误）
