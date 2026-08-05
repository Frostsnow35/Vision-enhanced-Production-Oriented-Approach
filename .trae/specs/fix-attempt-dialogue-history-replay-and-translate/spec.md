# Attempt 页面四项修复 Spec

## Why
当前 attempt1/attempt2 对话页面存在四个体验缺陷：(1) AI 经常不针对用户上一句具体话语作答，用泛泛兜底话术代替（如用户问"有没有别的口味"，AI 反问"还有什么需求"）；(2) 用户无法回顾历史对话，只能看到当前字幕；(3) 触词翻译功能因前端缺少 `NEXT_PUBLIC_DOUBAO_API_KEY` 环境变量而不可用；(4) AI 语音播放后无法再次收听。

## What Changes
- 强化后端 `_REPLY_PROMPT` 规则 #2，要求 AI 必须引用用户话语中的具体关键词作答，禁止泛泛追问"还有什么需要"
- 在 attempt1/attempt2 页面新增历史对话气泡区域，在 AI 头像区与底部控制栏之间，可滚动
- 新增后端 `/api/translate` 端点，用 `DOUBAO_API_KEY` 调火山引擎 ARK 做单词翻译；前端 `translateWord` 改为调此后端端点
- 在 AI 字幕区旁新增重播按钮，点击重新播放上一句 AI 语音

## Impact
- Affected specs: 无（纯增量修复）
- Affected code:
  - `poa-backend/services/chat_service.py` — 强化 `_REPLY_PROMPT` 规则 #2
  - `poa-backend/routers/translate.py` — **新建** `/api/translate` 端点
  - `poa-backend/main.py` — 注册 translate 路由
  - `poa-frontend/src/lib/translation.ts` — `translateWord` 改为调 `/api/translate`
  - `poa-frontend/src/app/attempt1/page.tsx` — 历史气泡 + 重播按钮
  - `poa-frontend/src/app/attempt2/page.tsx` — 历史气泡 + 重播按钮

## ADDED Requirements

### Requirement: AI 必须针对用户话语作答
AI 在每轮回复中 MUST 引用用户上一句话语中的至少一个具体关键词（如产品名、口味、状态），并基于该关键词进行回应的延伸。禁止仅以"Anything else?"、"还有什么需要"、"What else can I help?" 等泛泛兜底话术作为对用户具体问题的唯一答复。

#### Scenario: 用户提出具体问题
- **WHEN** 用户说 "Do you have any other flavors?"
- **THEN** AI 回复 MUST 包含 "flavors" 或具体口味名（如 "vanilla, chocolate"）
- **AND** AI MUST NOT 仅回复 "Anything else?"、"What else can I help?" 等泛泛话术
- **AND** AI 应先正面回答有/没有，再推进对话

#### Scenario: 用户说模糊短句
- **WHEN** 用户说 "I want something else"
- **THEN** AI 应追问具体细节（如 "What are you looking for — a different drink or maybe a snack?"）
- **AND** AI 不应直接跳到"还有什么需要"

#### Scenario: 用户正常推进对话
- **WHEN** 用户说 "A medium latte, please"
- **THEN** AI 回复 MUST 包含 "medium latte" 关键词确认
- **AND** AI 可在此基础上推进下一个子目标

### Requirement: 历史对话气泡区域
attempt1/attempt2 页面在 AI 头像区下方、底部控制栏上方之间 SHALL 有一个可滚动的对话气泡区域。

#### Scenario: 对话开始后
- **WHEN** `history.length >= 1`
- **THEN** 右栏 AI 头像区下方渲染一个可滚动气泡列表
- 用户消息：靠右、蓝色背景、圆角气泡
- AI 消息：靠左、灰色背景、圆角气泡，下方附 turn_feedback Mini 卡片（若有）
- 新消息自动滚动到底部
- 气泡内文本仍支持 ClickableEnglish 触词翻译

#### Scenario: 对话为空
- **WHEN** `history.length === 0`
- **THEN** 气泡区域不渲染或显示空态占位

### Requirement: 触词翻译后端代理
系统 SHALL 提供后端 `/api/translate` 端点，接收 `{ word: string }` 请求体，使用 `DOUBAO_API_KEY` 调用火山引擎 ARK 完成单词翻译，返回 `{ translation: string, phonetic: string }`。

#### Scenario: 翻译正常单词
- **WHEN** 前端 `translateWord("latte")` 调后端
- **THEN** 后端用 `DOUBAO_API_KEY` 调火山引擎 ARK chat/completions
- **AND** 返回 `{ translation: "拿铁咖啡", phonetic: "/ˈlæteɪ/" }`

#### Scenario: 翻译失败
- **WHEN** 后端 LLM 调用失败或解析失败
- **THEN** 返回 `{ translation: "（翻译失败）", phonetic: "" }`

#### Scenario: 前端改用后端端点
- **WHEN** 前端 `translateWord` 被调用
- **THEN** 不再读取 `NEXT_PUBLIC_DOUBAO_API_KEY`
- **AND** 改为 `fetch(BASE_URL + "/api/translate", { method: "POST", body: JSON.stringify({ word }) })`
- 保留前端 localStorage 缓存逻辑不变

### Requirement: AI 语音重播
AI 每轮语音播放结束后，当前字幕区旁 SHALL 出现一个小喇叭重播按钮，点击后重新播放该轮 AI 音频。

#### Scenario: AI 说完后
- **WHEN** AI 语音播放结束（audio.onended 触发）
- **AND** 该轮 `ai_audio_url` 存在
- **THEN** 字幕区旁显示重播按钮（小喇叭图标）
- 点击后使用 `new Audio(url).play()` 重新播放
- 重播过程中按钮显示 loading/播放中状态，播放结束后恢复

#### Scenario: 无音频的 AI 消息
- **WHEN** AI 消息没有 `ai_audio_url`
- **THEN** 不显示重播按钮

#### Scenario: 新一轮对话开始
- **WHEN** 用户开始新一轮录音
- **THEN** 上一轮的重播按钮自动隐藏（新 AI 回复到来后出现新的重播按钮）

## MODIFIED Requirements

### Requirement: `_REPLY_PROMPT` 规则 #2（应答具体性）
原规则 #2：
> 2. RESPOND SPECIFICALLY
> Always acknowledge what the student just said before adding your own input. If they ordered a latte, confirm it. If they asked a question, answer it directly. Show you listened.

现追加禁止条款：
> **FORBIDDEN**: Do NOT reply with generic follow-ups like "Anything else I can help you with?" / "What else can I do for you?" / "Is there anything else?" / "还有什么需要？" as your ONLY response to a specific question. If the student asks a question, ANSWER IT FIRST, then you may ask a follow-up. You MUST echo at least one keyword from the student's last message in your reply.

## REMOVED Requirements
无。
