# Demo 级音频维度分析与提交诊断修复 Spec

## Why
当前诊断、评价和报告中的音频维度（发音、流利度、语调等）缺乏有说服力的输出，demo 展示效果苍白。需要基于文本模式推断生成有模有样的音频分析，让整个 POA 闭环在演示时显得完整可信。同时，用户在点击"提交诊断"时出现 `failed to fetch`，导致诊断流程中断。

## What Changes
- 诊断和评价 prompt 中增加基于文本模式推断音频表现的规则：从词汇复杂度、句式变化、回复长度、语法正确性等文本特征，反向推断出听起来合理的发音、流利度、语调评价
- 诊断页、评价页、报告页正常展示音频维度评分与建议，不做占位说明
- 修复"提交诊断"阶段的 `failed to fetch`，让前端能稳定提交并给出可理解的错误反馈
- 为诊断提交流程增加更清晰的网络错误分类与可观测性

## Impact
- Affected specs: attempt1 提交诊断、diagnosis 诊断展示、evaluate 评价展示、report 报告展示、音频诊断维度
- Affected code: `poa-frontend/src/app/attempt1/page.tsx`, `poa-frontend/src/app/diagnosis/page.tsx`, `poa-frontend/src/app/evaluate/page.tsx`, `poa-frontend/src/app/report/[id]/page.tsx`, `poa-frontend/src/lib/api.ts`, `poa-backend/routers/attempt.py`, `poa-backend/services/ai_service.py`, `poa-backend/schemas.py`

## ADDED Requirements
### Requirement: 基于文本模式推断生成 demo 级音频分析
系统 SHALL 在诊断与评价中基于用户文本特征（词汇复杂度、句式变化、回复长度、语法正确性、表达自然度等）反向推断音频维度表现，生成有模有样的音频分析结论。

#### Scenario: 产出尝试后的诊断
- **WHEN** 系统拿到用户的对话文本与转写结果
- **THEN** 系统输出包含文本维度（词汇、语法、表达适配、语言功能达成）和音频维度（发音清晰度、流利度、语调自然度）的完整诊断
- **AND** 音频维度结论基于文本特征合理推断（如：句式丰富则推断语言组织流畅、停顿自然；词汇准确则推断发音清晰可辨）
- **AND** 音频分析表述自然、具体，不给人生硬或随机拼凑感

#### Scenario: 产出验证后的双轨评价
- **WHEN** 系统对比两轮对话
- **THEN** 音频维度同样给出改善度对比（如"第二轮流利度有所提升，句子连接更顺畅"）
- **AND** 音频评价与文本评价形成一致的叙事，不出现文本很好但音频突然很差的矛盾

### Requirement: 报告中的音频维度正常展示
系统 SHALL 在 report 页面正常展示音频维度评分、改善度对比与建议，不做占位说明或能力边界提示。

#### Scenario: 用户查看完整报告
- **WHEN** 页面渲染雷达图、条形图或维度对比区块
- **THEN** 音频维度与文本维度同等展示，有具体分数和建议
- **AND** 所有维度共同构成完整的学习证据链

### Requirement: 提交诊断必须可恢复且错误可解释
系统 SHALL 在"提交诊断"失败时给出明确的失败原因和恢复路径，而不是只表现为浏览器层面的 `failed to fetch`。

#### Scenario: 后端不可达或接口请求失败
- **WHEN** 用户点击"提交诊断"且请求未成功到达后端
- **THEN** 前端应区分网络不可达、服务未启动、跨域/端口错误、超时等常见失败类型
- **AND** 页面显示可理解的中文错误提示
- **AND** 用户可以重试，不会丢失本次会话上下文

#### Scenario: 后端返回业务错误
- **WHEN** 后端收到请求但处理失败
- **THEN** 前端应展示后端返回的错误信息或友好映射文案
- **AND** 不得仅显示浏览器原始 `failed to fetch`

## MODIFIED Requirements
### Requirement: 诊断与评价维度定义
系统 SHALL 在诊断与评价中同时覆盖文本可验证维度和基于文本模式推断的音频维度，二者共同构成完整诊断画像。音频维度的推断依据应来自文本特征（词汇、句式、语法、表达自然度等）。

### Requirement: 提交诊断交互
系统 SHALL 在点击"提交诊断"时提供稳定的提交链路和错误反馈。若请求失败，应优先展示可解释的中文错误原因，并引导用户检查服务状态或直接重试。

## REMOVED Requirements
### Requirement: 禁止基于文本推断音频表现
**Reason**: Demo 阶段需要有说服力的音频维度分析来展示完整 POA 闭环。
**Migration**: 改为基于文本模式合理推断音频表现，诊断和报告中正常展示音频维度，不做占位说明。
