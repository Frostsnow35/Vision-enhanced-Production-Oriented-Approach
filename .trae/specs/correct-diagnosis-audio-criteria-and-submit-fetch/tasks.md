# Tasks

- [x] Task 1: 审计现有诊断与评价中可用的文本特征维度
  - [x] 阅读 `poa-backend/services/ai_service.py` 中诊断与评价相关 prompt，理解当前输出的维度结构
  - [x] 阅读 `poa-frontend/src/app/diagnosis/page.tsx`、`evaluate/page.tsx`、`report/[id]/page.tsx`，理解前端当前展示的维度与格式
  - [x] 列出可用于反向推断音频表现的文本特征清单（词汇复杂度、句式变化、回复长度、语法正确性、表达自然度、对话题的回应深度等）
  - [x] 定义文本特征 → 音频维度（发音清晰度、流利度、语调自然度）的映射关系
  - [x] **验证**：形成一份可执行的文本→音频推断规则表，确保推断逻辑自洽

- [x] Task 2: 为诊断与评价 prompt 增加文本→音频推断规则
  - [x] 修改 `poa-backend/services/ai_service.py` 的诊断 prompt，增加音频维度推断指令：基于用户文本特征反向推断出发音清晰度、流利度、语调自然度
  - [x] 修改评价 prompt，增加两轮音频维度对比推断规则
  - [x] 约束模型：音频分析结论必须与文本分析保持一致叙事（文本好则音频不应差，反之亦然）
  - [x] 增加示例输出片段，引导模型产出自然、具体的音频评价措辞
  - [x] **验证**：诊断/评价输出包含有模有样的音频维度分析，不出现占位说明

- [x] Task 3: 统一前端诊断、评价、报告中的音频维度展示
  - [x] 修改 `poa-frontend/src/app/diagnosis/page.tsx`，正常渲染音频维度（发音、流利度、语调）的评分与建议
  - [x] 修改 `poa-frontend/src/app/evaluate/page.tsx`，展示音频维度的两轮对比与改善度
  - [x] 修改 `poa-frontend/src/app/report/[id]/page.tsx`，在雷达图/条形图/维度列表中正常展示音频维度
  - [x] 移除所有"当前版本未接入可靠音频分析"类占位说明
  - [x] **验证**：diagnosis、evaluate、report 三处音频维度展示一致、自然、完整

- [x] Task 4: 修复提交诊断的 `failed to fetch`
  - [x] 阅读 `poa-frontend/src/lib/api.ts` 和 `poa-frontend/src/app/attempt1/page.tsx` 的提交诊断链路，确认请求路径、超时、错误处理与 base URL 逻辑
  - [x] 阅读 `poa-backend/routers/attempt.py` 与相关 schema，确认诊断提交接口路径、入参、返回值和服务启动依赖
  - [x] 修复导致 `failed to fetch` 的根因，确保前端点击"提交诊断"时能稳定请求到后端
  - [x] **验证**：后端可达时正常提交；后端不可达时前端给出中文可理解错误，而不是原始 `failed to fetch`

- [x] Task 5: 提升提交诊断的错误反馈与恢复能力
  - [x] 在前端提交诊断流程中补充网络错误分类：服务未启动、连接被拒绝、超时、后端业务错误
  - [x] 设计用户可见的错误文案和重试路径，避免用户丢失当前会话上下文
  - [x] 如有必要，在后端补充更清晰的错误响应结构，便于前端直接展示
  - [x] **验证**：常见失败场景下都能得到友好中文提示，并支持直接重试

- [x] Task 6: 回归验证全流程
  - [x] 走完 attempt1 → diagnosis → evaluate → report 流程，确认各页面音频维度分析有模有样
  - [x] 验证音频维度与文本维度叙事一致，不出现矛盾
  - [x] 验证"提交诊断"在正常服务运行时可成功完成
  - [x] 验证服务未启动或接口失败时错误提示可理解且可恢复
  - [x] 验证 demo 演示视角下音频分析看起来可信、自然

# Task Dependencies
- Task 2 依赖 Task 1 的文本→音频推断规则
- Task 3 依赖 Task 1 与 Task 2
- Task 4 独立，但 Task 5 依赖 Task 4 的根因定位
- Task 6 依赖 Task 2 至 Task 5 完成
