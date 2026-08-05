# Tasks: 紧急修复 + 七维评估体系重构

## Phase 1: 紧急 Bug 修复

- [ ] Task 1: 修复 facilitate 页 SkeletonCard 崩溃
  - [ ] 在 `facilitate/page.tsx` 顶部添加 `import SkeletonCard from "@/components/ui/skeleton-card";`
  - [ ] 验证 facilitate 页面正常渲染

- [ ] Task 2: scenario 页加载动画优化
  - [ ] 在 `scenario/page.tsx` 修改提交按钮 JSX
  - [ ] 按钮 disabled 时显示旋转图标 + "分析中" + 副标题"正在识别场景并生成任务..."
  - [ ] 验证点击"生成交际任务"时按钮立即变 loading 态

- [ ] Task 3: task 页交际目标双语对照
  - [ ] 在 `task/page.tsx` 找到交际目标渲染区域
  - [ ] 用 `.split(/(\d+\.\s*)/)` 拆分目标字符串
  - [ ] 每点分为英文部分（黑字）+ 中文部分（灰色小字）两行展示
  - [ ] 验证界面显示"1. 英文...  中文..."

- [ ] Task 4: attempt1 录音按钮 + 设备调试面板
  - [ ] 在 `attempt1/page.tsx` 顶部声明 `videoRef`、`cameraStreamRef`、`audioStreamRef`
  - [ ] 添加设备状态 state：`cameraStatus`、`micStatus`、`micLevel`、`showDevicePanel`
  - [ ] 在 useEffect 中分别调用 `getUserMedia({video})` 和 `getUserMedia({audio})`
  - [ ] 失败时尝试从视频流 fallback 获取音频
  - [ ] 渲染设备调试面板（麦克风音量条使用 Web Audio API analyser）
  - [ ] 录音按钮 `disabled` 条件改为 `!micReady || uploading || isFinal`
  - [ ] 验证按"按住说话"超过 150ms 开始录音

- [ ] Task 5: attempt1 AI 语音播放
  - [ ] 在 callChatTurn 中 `if (data.ai_audio_url)` 分支创建 `new Audio(fullUrl)`
  - [ ] `audio.play().catch(...)` 失败仅 console.error，不弹 alert
  - [ ] `audio.onended` 设置 `setAiSpeaking(false)`
  - [ ] 验证 AI 回复后能听到声音

- [ ] Task 6: attempt2 同步录音 + 设备 + AI 语音改动
  - [ ] 将 attempt1 的修复同步到 attempt2
  - [ ] 验证 attempt2 录音和 AI 语音可用

## Phase 2: 评估体系重构

- [ ] Task 7: 后端 evaluate_service Prompt 重写
  - [ ] 将 `_DIMENSIONS` 改为 7 个标准维度（已有）
  - [ ] 重写 `_SINGLE_PROMPT`：明确 7 维度 + 各维度的子维度（发音4个、语法3个、词汇2个、语言功能2个、语用2个、话语回应3个、副语言4个）
  - [ ] 输出 JSON 包含每维度的 score (1-5) + comment（必须引用对话原文）
  - [ ] 重写 `_COMPARE_PROMPT`：每个维度的 comment 必须包含 3 要素（a1原文证据 + a2原文证据 + 变化原因）
  - [ ] 副语言匹配度仍由 audio_flu 决定；发音标准度仍由 audio_pron 决定

- [ ] Task 8: 后端评估响应结构对齐 Excel
  - [ ] 修改 `schemas.py` 中 `EvaluateResponse.dimension_scores` 为 `Dict[str, DimensionScore]`
  - [ ] `DimensionScore` 添加 `weight: float` 字段
  - [ ] 返回数据中 `dimension_scores` 的 7 个 key 固定为："发音标准度"/"语法规范性"/"词汇适配性"/"语言功能达成度"/"语用策略得体性"/"话语回合适配性"/"副语言匹配度"
  - [ ] 同时返回 `comparison` 数组（用于前端雷达图）

- [ ] Task 9: 前端 evaluate 页对齐 Excel
  - [ ] 移除页面中旧的 7 维度英文 key (fluency/accuracy/pragmatics...) 的 mock
  - [ ] `DIM_LABELS` 只保留 Excel 七维
  - [ ] 验证雷达图显示"发音标准度/语法规范性/..."7 个中文维度

- [ ] Task 10: 实时反馈卡片 (attempt1/attempt2)
  - [ ] 在 attempt1/page.tsx 添加 state `lastTurnFeedback`
  - [ ] 调用 `/api/chat-turn` 后端在响应中返回 `turn_feedback` 字段
  - [ ] 后端在 chat_service.py 中加入每轮反馈生成逻辑
  - [ ] 前端在 AI 消息下方显示 Mini 反馈卡片
  - [ ] 验证每轮对话后出现反馈

- [ ] Task 11: 学习旅程记录
  - [ ] 在 `lib/store.tsx` 添加 `learningJourney: JourneyEntry[]` 字段
  - [ ] 每次完成 attempt1 后写入一条 entry（场景 + 任务 + 时间 + 各维度分数）
  - [ ] 首页（/page.tsx）显示"你的学习旅程"卡片，列出最近 5 条
  - [ ] 验证刷新页面后仍能看到历史

## Phase 3: 验证 + 部署

- [ ] Task 12: 端到端验证
  - [ ] 重启前后端服务
  - [ ] 访问 http://localhost:3000
  - [ ] 完整跑通：上传 → 任务 → attempt1 → facilitate → attempt2 → evaluate
  - [ ] 验证所有 bug 已修复 + 评估输出符合 Excel 标准

# Task Dependencies

- Task 4, 5 依赖 Task 1（共用 state 重构）
- Task 6 依赖 Task 4, 5
- Task 8 依赖 Task 7
- Task 9 依赖 Task 8
- Task 10 依赖 Task 5
- Task 11 可与 Task 7-10 并行
- Task 12 依赖所有 Phase 1+2
