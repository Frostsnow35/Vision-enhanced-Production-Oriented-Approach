# Tasks

- [x] Task 1: 优化 VLM `_SCENE_PROMPT` 中 variant_plot 生成约束
  - [x] 修改 `poa-backend/services/ai_service.py` 中的 `_SCENE_PROMPT`，将 variant_plot 的行 217 从「变体必须和主情节有实质差异」改为「同场景同角色、仅改变子任务类型或交际目标，差异不超过一个交际维度」
  - [x] 同步更新 `_SCENE_PROMPT` 中 variant_plot 的示例说明，给出好/坏变体对照

- [x] Task 2: 优化 `_REPLY_PROMPT` 新增 AI 行为约束规则
  - [x] 在 `poa-backend/services/chat_service.py` 的 `_REPLY_PROMPT` 中新增 Rule: 禁止单向承诺型回复（不能只说"我去查/问"而不给结果），给出 BAD/GOOD 示例
  - [x] 在 `_REPLY_PROMPT` 中新增 Rule: 禁止连续反问不推进（必须先确认学生内容再引导），给出 BAD/GOOD 示例
  - [x] 在 `_REPLY_PROMPT` 中新增 Rule: 禁止主题漂移（回复必须与 variant_plot 方向一致），给出说明

- [x] Task 3: 优化 `_OPENING_PROMPT` 适配变体约束
  - [x] 在 `poa-backend/services/chat_service.py` 的 `_OPENING_PROMPT` 中增加约束：开场白必须反映变体情节方向，不得使用与主任务相同的开场白

- [x] Task 4: 前端新增 AI 回复质量检测工具函数
  - [x] 在 `poa-frontend/src/app/attempt2/page.tsx` 中新增 `detectLowQualityReply()` 函数，实现三种检测规则：
    - 死胡同检测：正则匹配 `let me go ask|I'll check with|I need to confirm|let me find out|I'll have to ask` 等模式
    - 连续反问检测：检测当前和历史上一轮 AI 回复是否都是纯问句（无陈述确认内容）
    - 主题偏离检测：提取 variant_plot 关键词，对比 AI 回复是否无交集
  - [x] 返回值含 `isLowQuality: boolean` 和 `reason: string`

- [x] Task 5: 前端新增「重新生成」重试按钮与交互逻辑
  - [x] 在 attempt2 页面的 AI 回复区域，当 `detectLowQualityReply()` 判定为低质量时，渲染「重新生成回复」按钮
  - [x] 点击按钮后：移除当前最后一轮 AI 回复，重新调用 `/api/chat/turn`（复用相同的 user_text 和 conversation_history 但不含被移除的 AI 轮）
  - [x] 加载态处理：重试期间禁用按钮，显示加载状态
  - [x] 失败降级：重试失败时保留原回复并提示用户

- [x] Task 6: 端到端验证
  - [x] 验证 variant_plot 约束更新：`_SCENE_PROMPT` 第 217 行已更新，第 219-222 行包含好/坏变体示例
  - [x] 验证 `_REPLY_PROMPT` 新增规则：Line 131 (Rule 8 单向承诺), Line 139 (Rule 9 反抛), Line 148 (Rule 10 主题漂移)
  - [x] 验证 `_OPENING_PROMPT` 新增约束：Line 74 (variant plot direction)
  - [x] 验证前端 `detectLowQualityReply` 函数存在 (2 处引用)
  - [x] 验证 `handleRetryAiReply` 函数存在 (2 处引用)
  - [x] 验证重试按钮渲染 ("重新生成回复" 2 处)
  - [x] 验证 attempt1 页面未受影响 (0 处 "attempt1" 引用)

# Task Dependencies
- Task 2 依赖 Task 1（需统一变体约束理解后再改对话 prompt）
- Task 3 依赖 Task 1（开场白需与变体约束一致）
- Task 5 依赖 Task 4（重试按钮依赖检测函数）
- Task 6 依赖 Task 1-5 全部完成
