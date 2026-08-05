# Tasks

- [x] Task 1: 修复 attempt1/attempt2 中 CountdownEffect 与 startAiOpening 的竞态条件
  - [x] 移除 CountdownEffect `onDone` 中对 countdownKey 的 setter 调用（改为空操作）
  - [x] 确保倒计时结束后 startAiOpening 可靠执行，不因 state 变更被 useEffect cleanup 取消
  - **涉及文件**: `poa-frontend/src/app/attempt1/page.tsx`, `poa-frontend/src/app/attempt2/page.tsx`

- [x] Task 2: 修改 CountdownEffect 倒计时颜色为白色+青色霓虹发光
  - [x] 将 `text-primary` 替换为 `text-white`
  - [x] 将 drop-shadow 改为 `drop-shadow-[0_0_30px_#22d3ee]`
  - [x] 将光晕层 `bg-primary` 替换为 `bg-cyan-400`
  - **涉及文件**: `poa-frontend/src/components/CountdownEffect.tsx`

- [x] Task 3: 接入豆包 TTS 替换 pyttsx3 + gTTS
  - [x] 在 `config.py` 中新增豆包 TTS 配置（APP_ID、ACCESS_TOKEN、VOICE_TYPE 等）
  - [x] 重写 `chat_service.py` 中 `text_to_speech()` 函数：豆包 TTS 为主，gTTS 为降级
  - [x] 移除 pyttsx3 依赖（代码 + requirements.txt）
  - [x] MD5 缓存逻辑保留（缓存到 `uploads/tts/`）
  - **涉及文件**: `poa-backend/config.py`, `poa-backend/services/chat_service.py`, `poa-backend/requirements.txt`

- [x] Task 4: 修复 opening_line/closing_line 链路断链
  - [x] 扩展 `api.ts` 中 `ScenarioResult` 类型增加 `opening_line` 和 `closing_line` 字段
  - [x] 扩展 `api.ts` 中 `chatStart()` 函数参数增加 `opening_line`
  - [x] 修改 `scenario/page.tsx`：将 `opening_line`/`closing_line` 存入 `currentTask` localStorage
  - [x] 修改 `attempt1/page.tsx` 和 `attempt2/page.tsx`：`chatStart` 调用时从 task 读取并传递 `opening_line`
  - [x] 增强 `ai_service.py` 中 `_sanitize_opening_line` 和 `_sanitize_closing_line`：新增时间戳过滤正则
  - **涉及文件**: `poa-frontend/src/lib/api.ts`, `poa-frontend/src/app/scenario/page.tsx`, `poa-frontend/src/app/attempt1/page.tsx`, `poa-frontend/src/app/attempt2/page.tsx`, `poa-backend/services/ai_service.py`

# Task Dependencies
- Task 1、Task 2、Task 3 相互独立，可并行执行
- Task 4 依赖于 Task 1 完成后的 attempt 页面代码稳定（同一文件修改）
