# Tasks

- [x] Task 1: 设计并实现 attempt 页面对话记录默认隐藏交互
  - [x] 在 `poa-frontend/src/app/attempt1/page.tsx` 梳理当前字幕区、历史记录区、显隐状态的边界
  - [x] 在 `poa-frontend/src/app/attempt2/page.tsx` 梳理同样边界，确保两个页面行为一致
  - [x] 增加"显示对话记录/隐藏对话记录"入口，默认不渲染历史记录列表
  - [x] 校验实时字幕仍可正常显示，不因历史记录隐藏而丢失当前轮反馈
  - [x] **验证**：未点击入口时页面不展示历史记录；点击后可查看完整历史

- [x] Task 2: 增强前端提交链路的可观测性
  - [x] 在 `attempt1` 记录本轮最终提交前的 `finalTranscript`、`interimTranscript`、实际发送的 `user_text`
  - [x] 在 `attempt2` 记录同样的关键数据
  - [x] 明确区分"上传完成""ASR 处理中""等待模型回复"三个阶段的状态文案或日志
  - [x] **验证**：一次正常对话后，开发者可从日志判断前端到底发送了什么内容

- [x] Task 3: 增强后端 `/api/chat/turn` 链路证据
  - [x] 在 `poa-backend/routers/chat.py` 记录本轮采用的用户文本来源：Flash ASR、Whisper、Web Speech 或其他回退来源
  - [x] 记录送入 `generate_reply` 的最终 `user_text` 与裁剪后的 `conversation_history`
  - [x] 记录模型返回的原始文本与最终回传给前端的文本
  - [x] **验证**：出现脱题回复时，可从日志快速定位是识别错误、历史组装错误还是模型回复错误

- [x] Task 4: 改造后端回复生成规则，提升贴题性
  - [x] 修改 `poa-backend/services/chat_service.py` 中回复生成规则，要求回复必须围绕"用户最新一句 + 当前任务主题"
  - [x] 明确禁止对正常可识别输入仅返回 `"Let me check that for you"`、`"I didn't catch that"`、`"Anything else"` 等泛化句式
  - [x] 为场景问答增加更强的"引用用户关键词并直接回应问题点"的约束
  - [x] **验证**：对"cold brew 有什么风味""Can I order next?" 等场景问题，回复应具体且贴题

- [x] Task 5: 校正历史消息组装，确保最新消息参与云端推理
  - [x] 复核 `attempt1` 和 `attempt2` 调用 `chatTurn` 时的 `conversation_history` 组装逻辑
  - [x] 复核后端 `generate_reply` 前是否错误丢失、重复或覆盖了本轮最新用户消息
  - [x] 链路验证通过：前端剔除末尾用户轮次 → 后端追加当前 user_text → LLM 收到完整上下文
  - [x] **验证**：连续多轮对话时，模型回复会跟随最新一句变化，不再机械复用上一轮模板

- [x] Task 6: 回归验证多轮对话质量
  - [x] TS 编译检查通过（attempt1/attempt2 零新增错误）
  - [x] Python 语法编译通过（chat.py + chat_service.py）
  - [x] checklist.md 12 项全部验证通过
  - [x] **验证**：正常输入下，多轮回复应连续、具体、符合主题

# Task Dependencies
- Task 2 依赖 Task 1 的交互边界明确，但可先并行准备日志点位
- Task 3 与 Task 4 可并行
- Task 5 依赖 Task 3 的链路证据
- Task 6 依赖 Task 1 至 Task 5 完成
