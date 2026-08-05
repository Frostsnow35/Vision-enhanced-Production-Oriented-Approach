# Tasks

- [ ] Task 1: 强化 AI 应答具体性（后端 prompt）
  - [ ] 修改 `poa-backend/services/chat_service.py` 中 `_REPLY_PROMPT` 规则 #2，追加禁止泛泛兜底话术条款
  - [ ] 规则要求 AI 必须引用用户上一句的至少一个关键词作答，禁止以 "Anything else?" / "What else can I help?" / "还有什么需要？" 作为对具体问题的唯一答复
  - [ ] **验证**：检查 prompt 文本中已包含 FORBIDDEN 条款和关键词引用要求

- [ ] Task 2: 新增后端 `/api/translate` 端点
  - [ ] 新建 `poa-backend/routers/translate.py`
  - [ ] 实现 POST `/api/translate`，接收 `{ word: string }`，用 `DOUBAO_API_KEY` 调火山引擎 ARK chat/completions 做单词翻译
  - [ ] 返回 `{ translation: string, phonetic: string }`，失败时返回 fallback
  - [ ] 在 `poa-backend/main.py` 注册 translate 路由
  - [ ] **验证**：用 curl 或浏览器测试 `POST /api/translate` 返回正确翻译

- [ ] Task 3: 前端翻译改为后端代理
  - [ ] 修改 `poa-frontend/src/lib/translation.ts` 中 `translateWord` 函数
  - [ ] 移除 `NEXT_PUBLIC_DOUBAO_API_KEY` / `NEXT_PUBLIC_DOUBAO_MODEL_ID` / `NEXT_PUBLIC_DOUBAO_BASE_URL` 环境变量读取
  - [ ] 改为 `POST BASE_URL + "/api/translate"` 调用后端端点
  - [ ] 保留 localStorage 缓存和 in-flight 去重逻辑
  - [ ] **验证**：打开页面点击英文单词，确认弹出翻译提示而非"未配置 API Key"

- [ ] Task 4: 新增历史对话气泡区域（attempt2）
  - [ ] 在 `poa-frontend/src/app/attempt2/page.tsx` 右栏 AI 头像区下方，新增可滚动气泡列表
  - [ ] 用户气泡：靠右蓝底；AI 气泡：靠左灰底，含 turn_feedback Mini 卡片
  - [ ] 气泡内文本支持 ClickableEnglish
  - [ ] 新消息自动 scrollToBottom
  - [ ] **验证**：录音几轮后确认气泡正确渲染且可滚动

- [ ] Task 5: 新增历史对话气泡区域（attempt1）
  - [ ] 先阅读 `poa-frontend/src/app/attempt1/page.tsx` 了解其布局结构
  - [ ] 将 attempt2 的气泡实现适配到 attempt1 页面
  - [ ] **验证**：在 attempt1 页面确认气泡渲染正确

- [ ] Task 6: 新增 AI 语音重播按钮（attempt2）
  - [ ] 在 `poa-frontend/src/app/attempt2/page.tsx` 字幕区旁添加重播按钮
  - [ ] 保留最新 AI 音频 URL 的 ref，AI 说完后显示按钮
  - [ ] 用户开始新录音时隐藏按钮
  - [ ] **验证**：AI 说完后重播按钮出现，点击可再次听到语音

- [ ] Task 7: 新增 AI 语音重播按钮（attempt1）
  - [ ] 先阅读 `poa-frontend/src/app/attempt1/page.tsx` 了解其字幕区布局
  - [ ] 将 attempt2 的重播实现适配到 attempt1 页面
  - [ ] **验证**：在 attempt1 页面确认重播功能正确

# Task Dependencies
- Task 2 与 Task 1 无依赖，可并行
- Task 3 依赖 Task 2（需后端端点就绪）
- Task 4 与 Task 5 可并行
- Task 6 与 Task 7 可并行
- Task 4/5/6/7 均与 Task 1/2/3 无直接依赖，可并行
