# 修复AI开场白、TTS英文发音、倒计时样式及场景链路 Spec

## Why
attempt1/attempt2 页面存在四个严重问题：(1) AI开场白完全不播放，用户倒计时结束后哑火；(2) 倒计时深蓝色在黑色摄像头背景上不可见且难看；(3) 系统TTS用pyttsx3时遇到数字/符号播中文发音；(4) VLM分析产出的opening_line/closing_line在前端链路中断，白浪费了场景化开场白。

## What Changes
- **修复** CountdownEffect 与 startAiOpening 之间的竞态条件导致 AI 开场白静默（前端 attempt1/attempt2）
- **修复** 倒计时动效颜色：从 `text-primary` 改为高可见度的亮色（白色 + 霓虹发光），确保在黑色摄像头画面上清晰可见
- **替换** TTS 引擎：移除 pyttsx3/gTTS 双策略，接入豆包 TTS（火山引擎语音合成），确保纯正英文发音
- **修复** 场景图片驱动任务链路：opening_line 和 closing_line 从前端到 chat API 的传递断链
- **增强** opening_line/closing_line 清洗规则：剔除时间戳、纯数字等不适宜作为语音播报的元素

## Impact
- Affected specs: 无（新 spec）
- Affected code:
  - `poa-frontend/src/components/CountdownEffect.tsx` — 修改颜色
  - `poa-frontend/src/app/attempt1/page.tsx` — 修复竞态 + 颜色 + 传递 opening_line
  - `poa-frontend/src/app/attempt2/page.tsx` — 修复竞态 + 颜色 + 传递 opening_line
  - `poa-frontend/src/lib/api.ts` — 扩展 chatStart/ScenarioResult 类型支持 opening_line/closing_line
  - `poa-frontend/src/app/scenario/page.tsx` — 透传 opening_line/closing_line
  - `poa-backend/services/chat_service.py` — 替换 TTS 为豆包 TTS
  - `poa-backend/services/ai_service.py` — 增强 _sanitize_opening_line/_sanitize_closing_line
  - `poa-backend/routers/chat.py` — 支持接收 opening_line（已支持，验证通过即可）
  - `poa-backend/config.py` — 新增豆包 TTS 相关配置

## ADDED Requirements

### Requirement: AI 开场白可靠播放
系统 SHALL 在倒计时结束后可靠触发 AI 开场白的 TTS 语音播放，不因竞态条件而静默。

#### Scenario: 倒计时后 AI 开场白正常播放
- **WHEN** 用户进入 attempt1 或 attempt2 页面，设备检测通过，3-2-1-GO 倒计时完成
- **THEN** AI 头像区显示"正在说话..."脉冲动画
- **AND** 浏览器自动播放 AI 开场白语音
- **AND** AI 说完后出现"显示字幕"脉动按钮

#### Scenario: API 失败时降级不静默
- **WHEN** `/api/chat/start` 调用失败
- **THEN** 降级使用客户端 mock 开场白，并通过 `/api/chat/tts` 生成语音播放
- **AND** 绝不出现倒计时结束后静默无反应的情况

### Requirement: 倒计时颜色在黑色背景上高可见
CountdownEffect 组件 SHALL 使用亮白色 + 青色/绿色霓虹发光效果，确保在黑色摄像头画面上清晰可辨。

#### Scenario: 倒计时叠加摄像头画面
- **WHEN** 倒计时数字叠加在 attempt1/attempt2 页面左侧的黑色摄像头实时画面之上
- **THEN** 数字使用白色 `text-white` 搭配 `drop-shadow-[0_0_30px_#22d3ee]` 青色发光
- **AND** 光晕层使用 `bg-cyan-400` 半透明替代原先的 `bg-primary`
- **AND** GO! 文字同样使用白色 + 青色发光

### Requirement: 豆包 TTS 英文发音
系统 SHALL 使用豆包（火山引擎）TTS 进行文本转语音，替代原有的 pyttsx3 + gTTS 双策略。

#### Scenario: 英文文本转语音
- **WHEN** 系统需要将英文文本转换为语音
- **THEN** 调用火山引擎 TTS API（`https://openspeech.bytedance.com/api/v1/tts`）
- **AND** 使用英语发音人（如 `en_us_002` 或等效 voice type）
- **AND** 生成的音频文件以 MD5 缓存到 `uploads/tts/` 目录

#### Scenario: TTS 缓存命中
- **WHEN** 同一段文本之前已生成过语音
- **THEN** 直接返回缓存的音频文件 URL，不重复调用 API

#### Scenario: 豆包 TTS 调用失败
- **WHEN** 豆包 TTS API 不可用
- **THEN** 降级使用 gTTS（`lang="en"`），确保离线/网络故障时仍可用
- **AND** 记录 warning 日志

### Requirement: 场景图片驱动任务链路完整
系统 SHALL 将 VLM 分析产出的 opening_line 和 closing_line 完整传递到 attempt1/attempt2 的 AI 对话流程中，优先使用 VLM 预生成的开场白而非 LLM 重新生成。

#### Scenario: 新场景 opening_line 传递
- **WHEN** VLM 分析照片成功产出 opening_line（经清洗后非空）
- **THEN** 前端 ScenarioResult 类型包含 opening_line/closing_line
- **AND** scenario 页面将其存入 localStorage 和 POA Context
- **AND** attempt1/attempt2 的 chatStart 调用携带 opening_line
- **AND** 后端 chat/start 优先使用传入的 opening_line

#### Scenario: VLM 未能产出有效 opening_line
- **WHEN** VLM 产出的 opening_line 被清洗后为空（数字串/JSON残留/编造产品名等）
- **THEN** 后端 chat/start 降级使用 generate_opening() LLM 生成

### Requirement: opening_line 清洗规则防时间戳
opening_line 和 closing_line 的清洗函数 SHALL 额外过滤时间戳和纯数字内容，确保 TTS 播放内容纯净。

#### Scenario: 过滤时间戳格式
- **WHEN** opening_line 或 closing_line 中包含 `YYYY-MM-DD`、`HH:MM`、纯数字串等
- **THEN** 清洗函数将其识别为无效并返回空字符串

## REMOVED Requirements

### Requirement: pyttsx3 TTS
**Reason**: pyttsx3 默认使用系统语音引擎，中文环境下遇到数字/符号会播中文发音，无法可靠锁定英文发音。
**Migration**: 替换为豆包 TTS（主）→ gTTS（降级）。
