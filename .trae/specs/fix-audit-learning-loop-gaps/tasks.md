# Tasks

- [ ] Task 1: AI 感知二次尝试上下文（后端）
  - [ ] 修改 `poa-backend/services/chat_service.py` 的 `generate_reply`，当 `is_variant == True` 且 `variant_context` 存在时，在 system message 中追加上下文："This is the student's SECOND attempt at this scenario. They have completed one round, received diagnostic feedback, and been given learning materials. The scenario now has a new twist: {variant_context}. You should maintain the same teaching role but note that the student is expected to show improvement."
  - [ ] 同样修改 `generate_opening` 的变体开场 prompt，使其在开场白中也体现"二次尝试"的语境
  - [ ] **验证**：检查 prompt 文本中已包含 SECOND attempt 相关描述

- [ ] Task 2: 修复 evaluate 页硬编码跳转
  - [ ] 阅读 `poa-frontend/src/app/evaluate/page.tsx`，定位"查看完整学习证据链"按钮（约第 471 行 `router.push("/report/1")`）
  - [ ] 改为 `router.push(\`/report/${scenarioId}\`)`，其中 `scenarioId` 从页面已有的 `loadEvaluationData` 逻辑中提取（如 `data.scenario_id` 或从 URL 参数获取）
  - [ ] **验证**：确认按钮不再硬编码 `1`

- [ ] Task 3: turn_feedback 挂在用户消息上（attempt1 + attempt2）
  - [ ] 阅读 `poa-frontend/src/app/attempt1/page.tsx` 的气泡渲染逻辑，将 `turn_feedback` 的维度标签和 short_comment 从 AI 气泡下方移到用户气泡下方
  - [ ] 阅读 `poa-frontend/src/app/attempt2/page.tsx` 的气泡渲染逻辑，做同样修改
  - [ ] 注意：AI 返回的 `turn_feedback` 附着在 `aiTurn` 上，但渲染时需要关联到上一轮用户消息。方案：遍历 history 时，用 `history[i+1]?.turn_feedback` 挂到 `history[i]`（用户轮次）下方
  - [ ] **验证**：确认反馈标签显示在用户消息气泡下方而非 AI 下方

- [ ] Task 4: 诊断文本加说话人标记
  - [ ] 阅读 `poa-frontend/src/app/attempt1/page.tsx` 的 `handleSubmit` 函数（约第 639 行）
  - [ ] 将 `const conversationText = history.map((h) => h.text || "").filter(Boolean).join("\n");`
  - [ ] 改为 `const conversationText = history.map((h) => { const role = h.role === "ai" ? "AI" : "你"; return \`[${role}]: ${h.text || ""}\`; }).join("\n");`
  - [ ] 保留原有的 `history.filter(h => h.role === "user").map(h => h.audio_url).filter(Boolean)` 逻辑不变
  - [ ] **验证**：提交前的 conversationText 包含角色前缀

- [ ] Task 5: 报告展示进步对比
  - [ ] 阅读 `poa-frontend/src/app/report/[id]/page.tsx` 的 `EvaluationContent` 组件
  - [ ] 修改维度评分渲染：每个维度显示两条分数条（灰色 attempt1 + 蓝色 attempt2）和绿色/红色变化量标签
  - [ ] 按变化量降序排列维度
  - [ ] 确保从 `comparison` 或 `dimension_scores` 中正确提取 attempt1、attempt2、change 值
  - [ ] **验证**：报告页能展示 A1/A2 对比

- [ ] Task 6: 初次产出传递 audio_urls 供发音评分
  - [ ] 前端 `attempt1/page.tsx` 的 `handleSubmit`：将已收集的 `attempt1_audio_urls` 传给后端 `POST /api/attempt1/submit` 的 body 中（新增字段 `audio_urls`）
  - [ ] 后端 `poa-backend/routers/attempt.py` 的 `attempt1_submit`：接收 `audio_urls`，解析为本地路径列表，传递给 `evaluate_single` 的 `audio_paths` 参数
  - [ ] 确认 `evaluate_service.py` 的 `evaluate_single` 已支持 `audio_paths` 参数（当前已有，只需确认调用链路正确）
  - [ ] **验证**：evaluate_single 收到非空 audio_paths 时执行 Whisper 词级分析

# Task Dependencies
- Task 1 独立，无依赖
- Task 2 独立，无依赖
- Task 3 独立，无依赖（两个页面可并行）
- Task 4 独立，无依赖
- Task 5 独立，无依赖
- Task 6 前端部分独立，后端部分需确认 evaluate_service.py 现有接口
- 全部 6 个 Task 均可并行执行
