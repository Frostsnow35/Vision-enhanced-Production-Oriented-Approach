# Day9: 录音波形修复 + 独立设备检测页 + AI 词典 + 隐藏逻辑审查

## Why
用户在 attempt1/attempt2 实际操作中遇到三个问题：(1) "按住说话"按钮反应不灵敏，音量波形无法反映真实说话强度；(2) 设备状态仅作为内嵌小条显示，缺少独立的"快速检测"入口，facilitate 页面甚至没有设备调试；(3) 之前规划的 AI 词典（一键点词查中文）功能一直未实现；(4) 多个页面存在隐藏/早退逻辑分歧，需要系统审查并修复。

## What Changes

### 1. 录音波形修复
- `attempt1/page.tsx`、`attempt2/page.tsx` - 把 `getByteFrequencyData` 频域平均改为 `getByteTimeDomainData` 时域 RMS
- 渲染从单条 progress bar 改为**柱状条**（12 根柱，按频率分布归一化）
- 录音按钮：删除 150ms `setTimeout` 延迟，`onPointerDown` 立即触发 `beginRecord()`

### 2. 独立设备检测页 + 入口
- 新建 `app/device-check/page.tsx`
- 包含：摄像头实时预览（video）、麦克风柱状条（10 根柱）、检测状态指示（✓/✗ + 颜色）、失败原因文字说明（NotAllowedError / NotFoundError / NotReadableError / 通用）、重新检测按钮
- 通过状态写入 `localStorage.device_check_passed=true` + 时间戳
- 入口：attempt1 / attempt2 / facilitate **三处页面右上角**各加一个"🎛 设备检测"按钮，点击 `router.push("/device-check")`
- 设备未就绪交互：相关功能按钮（如"按住说话"）置灰 + tooltip "请先完成设备检测"，点击不触发
- 持久化：进入 attempt1/2/facilitate 时读 `device_check_passed`，未通过则按钮置灰

### 3. AI 词典（点击词查翻译）
- 新建 `lib/translation.ts` - `translateWord(word): Promise<{translation, phonetic}>`
  - **职责分工**：本函数调用时 LLM 扮演"英汉词典"角色（与对话/评估/促成的 LLM 角色严格区分）
  - 直接调 LLM（doubao-seed-2-0-mini-260428）
  - **严格 system prompt**：
    ```
    你是英汉词典工具。你的唯一职责：把用户输入的英文词翻译成中文，并给出音标。
    输出格式（严格 JSON，不要加任何解释、不要 markdown）：
    {"translation": "最常见的中文释义，15字以内", "phonetic": "简版音标，如 /ˈlæteɪ/"}
    ```
  - 缓存 key：localStorage `poa_word_cache`，TTL 30 天
- 新建 `components/WordTooltip.tsx` - 浮层显示翻译 + 音标 + 收藏按钮
- 修改 AI 消息渲染：把 AI 文本按 `/\b[a-zA-Z']+\b/g` 拆词，每个词包裹为 `<span>` 可点击
- 点击词 → 显示 Tooltip（Popover）
- 涉及位置：attempt1 / attempt2 / diagnosis / evaluate / report 页面所有展示 AI 文本的地方
- 范围：所有英文词都可点击

### 4. 隐藏逻辑审查
- 全面审查 facilitate / diagnose / evaluate 三个页面的所有早退（`if (!x) return ...`）与隐藏（`hidden`、`display: none`）条件
- 输出审查报告（issues + 已修复 / 无需修改说明）
- 重点排查：
  - 诊断列表为空的兜底
  - evaluate 未完成时的路由守卫
  - facilitate 加载与任务未就绪的时序
  - 评分数据为空时是否仍渲染图表

## Impact

### Affected specs
- 继承：core-features-empowerment、urgent-fixes-and-eval-refactor

### Affected code
**新增**:
- `poa-frontend/src/app/device-check/page.tsx` - 设备检测独立页
- `poa-frontend/src/lib/translation.ts` - 词典翻译工具
- `poa-frontend/src/components/WordTooltip.tsx` - 词翻译浮层

**修改**:
- `poa-frontend/src/app/attempt1/page.tsx` - 波形算法 + 设备检测入口 + 词点击 + 按钮置灰
- `poa-frontend/src/app/attempt2/page.tsx` - 同步
- `poa-frontend/src/app/facilitate/page.tsx` - 设备检测入口 + 按钮置灰
- `poa-frontend/src/app/diagnosis/page.tsx` - 词点击
- `poa-frontend/src/app/evaluate/page.tsx` - 词点击 + 隐藏逻辑审查
- `poa-frontend/src/app/report/[id]/page.tsx` - 词点击

## ADDED Requirements

### Requirement: 真实反映声音的波形
后端无变化。前端在 attempt1/attempt2 中使用 `getByteTimeDomainData` 计算时域 RMS，并渲染为 12 根柱状条。

#### Scenario: 用户说话
- **WHEN** 用户对着麦克风说话
- **THEN** 12 根柱根据实时声音强度波动，柱高在 0-100% 之间变化

#### Scenario: 安静环境
- **WHEN** 用户不发出声音
- **THEN** 柱高应保持 < 10%

### Requirement: 录音按钮立即响应
按住说话按钮无延迟。

#### Scenario: 按下按钮
- **WHEN** 用户 `onPointerDown` 立即按下
- **THEN** 立即开始录音（< 50ms 内），不延迟 150ms

#### Scenario: 松开按钮
- **WHEN** 用户 `onPointerUp` 或 `onPointerLeave`
- **THEN** 立即结束录音，触发上传与 ASR

### Requirement: 独立设备检测页
新页面 `/device-check` 提供完整的设备检测流程。

#### Scenario: 进入设备检测页
- **WHEN** 用户从 attempt1/attempt2/facilitate 点击"🎛 设备检测"
- **THEN** 进入 `/device-check` 页面，自动开始摄像头+麦克风检测
- 检测页提供"返回"和"重新检测"按钮

#### Scenario: 检测通过
- **WHEN** 摄像头和麦克风都正常
- **THEN** 显示两个绿色 ✓ 标记 + 写入 `localStorage.device_check_passed=true`
- 页面显示"返回"按钮可返回来源页

#### Scenario: 检测失败
- **WHEN** 摄像头或麦克风无法获取
- **THEN** 显示红色 ✗ + 失败原因（"请允许浏览器使用摄像头/麦克风"、"未检测到设备"等）
- 显示"重试"按钮

### Requirement: 设备未就绪置灰交互
attempt1/attempt2/facilitate 中的关键功能按钮在设备未通过检测时置灰。

#### Scenario: 未通过设备检测
- **WHEN** `localStorage.device_check_passed` 不为 `true`
- **THEN** 录音按钮（attempt1/attempt2）、录制按钮（facilitate）置灰，hover 显示 tooltip "请先完成设备检测"
- 点击不触发录音/录制

#### Scenario: 已通过设备检测
- **WHEN** `localStorage.device_check_passed === "true"`
- **THEN** 按钮正常可用

### Requirement: AI 词典
attempt1/attempt2/diagnosis/evaluate/report 页面中所有 AI 文本的英文词可点击查翻译。

#### Scenario: 点击英文词
- **WHEN** 用户点击 AI 消息中的英文词（如 "latte"）
- **THEN** 在词上方/下方显示 Popover Tooltip：
  - 中文翻译（最大 30 字）
  - 音标（IPA 或简版）
  - 收藏按钮（可选）

#### Scenario: 翻译缓存命中
- **WHEN** 同一词再次点击
- **THEN** 直接使用 localStorage 缓存（30 天内），不再调 LLM

#### Scenario: 翻译失败
- **WHEN** LLM 翻译调用失败
- **THEN** Tooltip 显示"翻译暂不可用"，不抛错

### Requirement: 隐藏逻辑审查
完成 facilitate / diagnose / evaluate 三个页面的隐藏与早退逻辑审查，输出报告并修复发现的明显 bug。

#### Scenario: 审查完成
- **WHEN** 审查结束
- **THEN** 输出审查报告 `docs/day9-hidden-logic-audit.md`，列出所有 `if (!x) return ...` / `hidden` / `display:none` 位置及评估（合理/已修复）
- 修复发现的明显 bug

## MODIFIED Requirements
无。

## REMOVED Requirements
无。
