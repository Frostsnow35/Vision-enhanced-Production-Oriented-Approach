# Checklist: 紧急修复 + 七维评估体系重构

## Phase 1: 紧急 Bug 修复

- [x] /facilitate 页面不再报 "SkeletonCard is not defined"
- [x] /scenario 页面提交后按钮立即变为 loading 态，显示"分析中"+"正在识别场景并生成任务..."
- [x] /task 页面交际目标按 1/2/3 分点显示，每点英文 + 中文对照
- [x] /attempt1 页面"按住说话"按钮在麦克风 ready 后可用
- [x] /attempt1 页面顶部"设备"按钮可展开调试面板
- [x] /attempt1 设备面板显示摄像头状态（绿/黄/红圆点）
- [x] /attempt1 设备面板显示麦克风状态（绿/黄/红圆点）
- [x] /attempt1 设备面板显示麦克风实时音量条（0-100%）
- [x] /attempt1 AI 回复后能听到 AI 声音
- [x] /attempt2 页面同步具备上述能力

## Phase 2: 评估体系重构

- [x] 后端 `_SINGLE_PROMPT` 包含 7 维度的完整子维度描述
- [x] 后端 `_COMPARE_PROMPT` 要求每个维度的 comment 包含 a1 原文 + a2 原文 + 变化原因
- [x] 后端 `EvaluateResponse` 返回 `dimension_scores` 包含 7 个中文维度的 key
- [x] 后端 `DimensionScore` 包含 `weight` 字段
- [x] 后端 `DimensionScore` 包含 `comment` 字段
- [x] 前端 evaluate 页雷达图显示 7 个中文维度（发音/语法/词汇/语言功能/语用/话语回应/副语言）
- [x] 前端 evaluate 页不再使用旧的 7 英文维度 mock
- [x] 前端 attempt1/attempt2 每轮 AI 回复后显示反馈小卡片
- [x] 首页 / 显示"学习旅程"卡片，列出最近历史

## Phase 3: 验证

- [x] 重启前后端服务
- [x] 完整跑通：上传 → 任务 → attempt1 → facilitate → attempt2 → evaluate
- [x] 评价页输出符合 Excel 七维标准
- [x] 录音和 AI 语音都正常工作
- [x] 设备调试面板状态准确
