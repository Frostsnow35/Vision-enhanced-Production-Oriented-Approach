# Tasks: 核心功能增强（实时反馈 + 学习旅程 + 针对性促成）

## Phase 1: 后端实时反馈

- [ ] Task 1: 后端 chat-turn 响应增加 turn_feedback
  - [ ] 在 `chat.py` router 中扩展 ChatTurnResponse：`turn_feedback: dict = {}`
  - [ ] 在 `chat_service.py` 中调用 LLM 生成短反馈 prompt（沿用 Excel 七维语言）
  - [ ] 失败时 turn_feedback = {}（不抛错）
  - [ ] 验证：调用 chat-turn 返回 response.turn_feedback

## Phase 2: 前端实时反馈卡片

- [ ] Task 2: 前端 lib/api.ts 类型扩展
  - [ ] 在 chatTurn 返回类型加 `turn_feedback?: { dimensions: string[]; short_comment: string }`
  - [ ] 验证编译通过

- [ ] Task 3: attempt1 Mini 反馈卡片
  - [ ] 添加 `lastTurnFeedback` state
  - [ ] 在 `chatTurn` 成功回调中写入
  - [ ] 在 AI 消息下方渲染 Mini 卡片（dimensions 标签 + 短评 + 折叠箭头）
  - [ ] 添加 `feedbackCollapsed` state 控制折叠
  - [ ] 验证：录音→AI回复→卡片出现

- [ ] Task 4: attempt2 Mini 反馈卡片
  - [ ] 将 attempt1 的反馈卡片实现同步到 attempt2
  - [ ] 验证：attempt2 录音后也出现卡片

## Phase 3: 学习旅程

- [ ] Task 5: 前端 store.tsx 增加 learningJourney
  - [ ] 类型定义 `JourneyEntry`
  - [ ] 函数 `addJourneyEntry`、`getLearningJourney`、`clearLearningJourney`
  - [ ] localStorage key: `learning_journey`

- [ ] Task 6: evaluate 页写入 journey
  - [ ] 在 evaluate 加载数据成功后调用 `addJourneyEntry`
  - [ ] 包含：场景、任务标题、avgScore、dimensionScores、completedAt
  - [ ] 验证：完成 evaluate 后 localStorage 出现新 entry

- [ ] Task 7: 首页学习旅程区域
  - [ ] 在 `app/page.tsx` 添加"学习旅程"区
  - [ ] 显示最近 5 条 entry
  - [ ] 每条 entry 显示：场景标签、任务标题前 30 字、圆环均分、相对时间
  - [ ] 空态卡片："还没有学习记录"
  - [ ] 验证：刷新首页后显示历史

## Phase 4: 针对性促成学习

- [ ] Task 8: attempt1 完成后写入 diagnosis
  - [ ] 在 attempt1 `isFinal` 时机写入 `localStorage.diagnosis`（从 chatStart/chatTurn 累积的对话文本生成 1-2 句简易诊断，或引用后端诊断接口）
  - [ ] 若已有 diagnosis 缓存则不覆盖

- [ ] Task 9: facilitate 页读取 diagnosis + 传 gaps
  - [ ] 在 useEffect 读取 `localStorage.diagnosis`
  - [ ] 调用 `/api/generate-input` 时 body 增加 `gaps` 字段
  - [ ] 验证：facilitate 接收的练习标题包含"针对你的 X"

- [ ] Task 10: 后端 generate-input 支持 gaps
  - [ ] 在 router 的 request schema 增加 `gaps: list = []`
  - [ ] 在 service 拼接 prompt：若 gaps 非空，加入"基于以下问题生成针对性练习"
  - [ ] 验证：传入 gaps 时练习标题前缀改变

# Task Dependencies

- Task 2 依赖 Task 1（API 类型对齐）
- Task 4 依赖 Task 3
- Task 6 依赖 Task 5
- Task 7 依赖 Task 6
- Task 9 依赖 Task 8 + Task 10
- Task 10 可与 Task 1 并行
