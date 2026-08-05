# 紧急修复 + 七维评估体系重构 Spec

## Why
项目当前存在多处紧急 bug（促成页崩溃、加载体验差、录音按钮失效、设备调试缺失、目标未双语对照），同时 Excel 七维评估表定义的标准化评分体系尚未在后端评估 Prompt 中落地。需要一次性解决关键 bug + 重构评分体系以匹配 Excel 文档，并借鉴 Viseal.ai 的产品化交互。

## What Changes

### 紧急 Bug 修复
- 修复 `/facilitate` 页面 SkeletonCard 未定义导致崩溃
- `/scenario` 页面：图片生成任务时显示"分析中"加载状态
- `/task` 页面：交际目标按点拆分，每点英文 + 中文对照
- `/attempt1` 页面：修复"按住说话"按钮逻辑 + 设备调试面板 + 麦克风音量实时显示

### 评估体系重构
- 后端 Prompt 严格对齐 Excel 七维评分表（发音/语法/词汇/语言功能/语用/话语回应/副语言）
- 前端实时反馈：每轮对话结束显示维度小分 + 错误点
- AI 语音播放功能
- 学习旅程历史记录可视化

## Impact

### Affected specs
- 影响：ui-polish（冲突任务归并）
- 继承：viseal-inspired 借鉴

### Affected code
- `poa-frontend/src/app/scenario/page.tsx` - 加载动画
- `poa-frontend/src/app/task/page.tsx` - 交际目标双语
- `poa-frontend/src/app/attempt1/page.tsx` - 录音 + 设备 + 实时反馈
- `poa-frontend/src/app/attempt2/page.tsx` - 录音 + 设备 + 实时反馈
- `poa-frontend/src/app/facilitate/page.tsx` - SkeletonCard 导入
- `poa-frontend/src/app/evaluate/page.tsx` - 评分严格对齐
- `poa-backend/services/evaluate_service.py` - Prompt 重写
- `poa-backend/schemas.py` - 评估数据结构
- `poa-backend/services/audio_analysis_service.py` - 已有，扩展
- `poa-frontend/src/components/RecordingWaveform.tsx` - AI 语音播放
- `poa-frontend/src/lib/store.tsx` - 学习旅程记录

## ADDED Requirements

### Requirement: 修复 SkeletonCard 崩溃
系统必须在 `/facilitate` 页面正确导入 `SkeletonCard` 组件。

#### Scenario: 促成页加载
- **WHEN** 用户进入 `/facilitate` 页面
- **THEN** 不再报 "SkeletonCard is not defined" 错误，页面正常渲染加载状态

### Requirement: 场景驱动加载状态
系统应在图片生成任务时显示"分析中"加载状态。

#### Scenario: 提交生成任务
- **WHEN** 用户上传照片并点击"生成交际任务"
- **THEN** 按钮变为不可点击状态，显示"分析中"+"正在识别场景并生成任务..."文字 + 旋转图标

### Requirement: 交际目标双语对照
系统应在任务页显示交际目标，每点英文 + 中文对照。

#### Scenario: 任务页显示
- **WHEN** 用户进入 `/task` 页面
- **THEN** 交际目标按数字编号 1/2/3 拆分，每点的英文描述在上，中文释义在下

### Requirement: 录音按钮可用性
系统应保证"按住说话"按钮在设备就绪后立即可用。

#### Scenario: 按住说话
- **WHEN** 麦克风状态为 ready
- **THEN** 按钮显示"按住说话"，按压超过 150ms 后开始录音

#### Scenario: 设备未就绪
- **WHEN** 麦克风状态非 ready
- **THEN** 按钮显示"麦克风未就绪"并禁用

### Requirement: 设备调试面板
系统应在任务页提供摄像头/麦克风状态实时显示。

#### Scenario: 设备状态显示
- **WHEN** 用户点击顶部"设备"按钮
- **THEN** 展开面板显示摄像头状态（正常/失败/初始化中）、麦克风状态、麦克风实时音量条（百分比）

### Requirement: 麦克风音量实时显示
系统应通过 Web Audio API 实时显示麦克风音量。

#### Scenario: 麦克风音量条
- **WHEN** 麦克风就绪后用户说话
- **THEN** 音量条宽度随声音大小变化 0-100%

### Requirement: AI 语音播放
系统应在 AI 回复后自动播放 AI 语音。

#### Scenario: AI 语音播放
- **WHEN** AI 回复包含 `ai_audio_url`
- **THEN** 前端自动创建 Audio 对象播放该 URL，播放结束前 AI 头像显示"正在说话..."动效

### Requirement: 评估 Prompt 严格对齐 Excel
后端评估 Prompt 必须严格按 Excel 七维评分表的子维度、权重、评分阈值生成评分。

#### Scenario: 发音标准度评分
- **WHEN** 后端调用 LLM 评估
- **THEN** Prompt 中发音标准度必须包含 4 个子维度：元音辅音、重音、语调、语流；评分按 Excel 阈值：1分（错误率≥35%）、2分（20-34%）、3分（<15%）、4分（复杂词微偏差）、5分（无系统性错误）

#### Scenario: 语法规范性评分
- **WHEN** 后端调用 LLM 评估
- **THEN** Prompt 中语法规范性必须包含 3 个子维度：主谓一致/时态/语态、虚词（冠词/介词/代词）、复杂结构（从句/被动）

#### Scenario: 副语言匹配度自动评分
- **WHEN** 用户的产出包含音频
- **THEN** 发音标准度由 Whisper 词级置信度计算，副语言匹配度由 WPM（词/分钟）+ 停顿频率计算，LLM 必须直接采用这些分数

### Requirement: 评估数据结构
后端返回的 `dimension_scores` 必须包含 Excel 七维 + 各维度的子维度分数 + 评语引用对话原文。

#### Scenario: 评估响应格式
- **WHEN** 前端调用 `/api/evaluate-compare`
- **THEN** 返回 JSON 包含：
  ```
  {
    "dimension_scores": {
      "发音标准度": { "attempt1": 2.5, "attempt2": 4.0, "weight": 0.20, "comment": "..." },
      "语法规范性": { "attempt1": 3.0, "attempt2": 4.0, "weight": 0.15, "comment": "..." },
      ... // 7 个维度
    },
    "comparison": [...], // 与 dimension_scores 等价的数组格式
    "target_evaluation": [...] // 靶向 gap 改善评估
  }
  ```

### Requirement: 每轮实时反馈
系统应在每次对话轮次后显示该轮的小反馈卡片。

#### Scenario: 实时反馈卡片
- **WHEN** AI 回复完一轮
- **THEN** 在 AI 消息下方显示一个小卡片，包含：本轮涉及的维度（语法/词汇/语用/话语回应）+ 短评（15-30字）

## MODIFIED Requirements
无。本次为新增需求，不改动现有功能逻辑。

## REMOVED Requirements
无。
