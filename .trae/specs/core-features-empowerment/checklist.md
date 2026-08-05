# Checklist: 核心功能增强（实时反馈 + 学习旅程 + 针对性促成）

## Phase 1: 后端实时反馈

- [x] /api/chat-turn 响应中包含 `turn_feedback` 字段
- [x] turn_feedback 包含 dimensions（≤3 个维度）和 short_comment（15-30 字）
- [x] short_comment 引用用户本轮原文中具体词句
- [x] 失败时 turn_feedback = {}（不抛错）

## Phase 2: 前端实时反馈卡片

- [x] attempt1 chatTurn 返回类型含 turn_feedback
- [x] attempt1 在 AI 消息下方显示反馈 Mini 卡片
- [x] 卡片显示 dimensions 标签（不同颜色）
- [x] 卡片显示 short_comment
- [x] 卡片可折叠
- [x] attempt2 同步具备上述能力

## Phase 3: 学习旅程

- [x] store.tsx 含 learningJourney state + JourneyEntry 类型
- [x] evaluate 完成后写入一条 entry
- [x] 首页 / 显示"学习旅程"区域
- [x] 显示最近 5 条 entry
- [x] 每条 entry 含场景、任务标题、圆环均分、相对时间
- [x] 空态显示"还没有学习记录"
- [x] 刷新页面后历史仍存在

## Phase 4: 针对性促成学习

- [x] attempt1 完成后写入 localStorage.diagnosis
- [x] facilitate 页读取 diagnosis
- [x] /api/generate-input 接受 gaps 参数
- [x] 传入 gaps 时练习标题前缀包含"针对你的 X"
- [x] 练习内容与诊断问题强相关
