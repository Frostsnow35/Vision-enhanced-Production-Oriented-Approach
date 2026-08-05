# 诊断报告 + 加载提示 + Facilitate 配色 + Report 修复 Spec

## Why
用户试用第二轮发现的 4 个问题：
1. **诊断报告** 只显示 `evidence_sentence`（原句）但没有"参考表达"对照，智能化不够，未能与用户上次的 attempt 紧密绑定
2. **/facilitate、/evaluate** 加载慢，但加载时缺乏友好提示（"稍等，内容正在快马加鞭赶过来"），用户心理等待时间被拉长
3. **/facilitate 红色过多**：大量 `destructive` 红色元素（`最需关注`角标、序号、标题），不利于学习者体验
4. **/report 页 bug**：报告 API 失败（404/500/网络错误）时静默失败（`if (res.ok) setReport(...)`），用户已完成的模块数据全部显示"暂无..."，体验为"刚刚有数据但报告说没有"

## What Changes
- **新增** 后端 `Gap.reference_expression` 字段（DB + Schema + AI prompt）
- **新增** 后端 `services/ai_service.py` 高频错误提取函数 `_extract_high_freq_errors(attempt_text, gaps) -> {phrase: str, occurrence: int, suggestion: str}[]`
- **修改** 后端 `services/ai_service.py` `analyze_diagnose` prompt：要求返回 `reference_expression` + `high_freq_errors`
- **修改** 后端 `routers/attempt.py` submit 接口：诊断后多调用一次 `_extract_high_freq_errors`，合并到 response 中
- **修改** 前端 `diagnosis/page.tsx`：在 gap 卡片内增加"原句 vs 参考"对照（左右分栏），顶部增加"高频错误"摘要区块
- **新增** 前端 `components/InlineLoadingHint.tsx`：内容应呈现位置显示的"稍等"提示组件（3-4 种友好文案轮换）
- **修改** 前端 `facilitate/page.tsx`、`evaluate/page.tsx`：在每个 content 区块添加 `InlineLoadingHint`（替代/补充现有 skeleton）
- **修改** 前端 `facilitate/page.tsx`：所有 `destructive`/`text-red-*` 颜色按"严重度"重新分配——仅最严重警告保留红，其他换为 `primary`/`amber`/`muted`
- **修复** 前端 `report/[id]/page.tsx`：API 失败时显示错误提示 + 重试按钮；scenarioId 缺失时引导重新选择任务
- **修改** 前端 `report/[id]/page.tsx`：增加 `try/catch` 包裹 fetch 错误并 `setReportError(...)`

## Impact
- Affected specs: diagnosis-page, facilitate-page, evaluate-page, report-page, gap-model, attempt-router
- Affected code:
  - `poa-project/poa-backend/models.py` — **新增** Gap.reference_expression / high_freq_errors 字段
  - `poa-project/poa-backend/schemas.py` — **新增** Gap 字段
  - `poa-project/poa-backend/services/ai_service.py` — **修改** diagnose prompt + **新增** `_extract_high_freq_errors`
  - `poa-project/poa-backend/routers/attempt.py` — **修改** submit_attempt1 串联高频错误提取
  - `poa-project/poa-frontend/src/components/InlineLoadingHint.tsx` — **新增**
  - `poa-project/poa-frontend/src/app/diagnosis/page.tsx` — **修改** gap card UI + 高频错误区块
  - `poa-project/poa-frontend/src/app/facilitate/page.tsx` — **修改** 加载提示 + 配色
  - `poa-project/poa-frontend/src/app/evaluate/page.tsx` — **修改** 加载提示
  - `poa-project/poa-frontend/src/app/report/[id]/page.tsx` — **修复** 错误处理

## ADDED Requirements

### Requirement: 诊断报告 - 原句 + 参考表达对照
诊断卡 SHALL 在 evidence_sentence 下方显示"原句（你这么说）"和"参考表达（建议这样说）"两栏对照。原句 SHALL 用 `bg-muted/30 italic` 区分，参考 SHALL 用 `bg-primary/5 text-primary` 区分，视觉上形成"问题→建议"对比。

#### Scenario: 报告正常对照
- **WHEN** 访问 /diagnosis 且 gap 有 `reference_expression`
- **THEN** 卡片 SHALL 显示两栏对照
- **AND** 原句在左、参考在右
- **AND** 参考栏 SHALL 高亮显示（`border-l-2 border-l-primary`）

#### Scenario: 老数据无 reference
- **WHEN** 访问 /diagnosis 且 gap 无 `reference_expression`（旧数据）
- **THEN** 卡片 SHALL 只显示原句
- **AND** 提示文字"建议这样说：xxx" 降级为 `gap.explanation` 内容

### Requirement: 诊断报告 - 高频错误智能提取
诊断页 SHALL 在标题区下方显示"高频错误"摘要区块，含 1-3 条 phrase-level 错误（按出现频次降序），每条显示：
- 错误短语（带 `bg-amber-100 text-amber-800` 高亮）
- 出现次数（带"x N"角标）
- 修正建议（1 句话）

#### Scenario: 正常显示
- **WHEN** 接口返回 high_freq_errors 数组
- **THEN** 页面 SHALL 在 <h1> 下方渲染最多 3 个 tag
- **AND** 每个 tag 点击后可滚动到对应 gap 卡片

#### Scenario: 空数组
- **WHEN** high_freq_errors 为空（用户发言太短）
- **THEN** 整个"高频错误"区块 SHALL 隐藏（不显示空标题）

### Requirement: 内容应呈现位置的内联加载提示
新增 `InlineLoadingHint` 组件 SHALL：
- 在内容应出现位置渲染
- 文案友好（如"稍等，AI 正在快马加鞭整理你的内容..."、"💡 内容正在生成中"），3-4 条轮换
- 加载完成后渐入真实内容
- 视觉上是 placeholder 灰底 + 微动效，不弹全屏 modal

#### Scenario: 等待中
- **WHEN** 区块 loading=true
- **THEN** InlineLoadingHint SHALL 显示，文案每 2.5 秒切换
- **AND** 周围 SHALL 有 shimmer 动画

#### Scenario: 加载完成
- **WHEN** 区块 loading=false 且 data 不为空
- **THEN** InlineLoadingHint SHALL 消失
- **AND** 真实内容 SHALL 渐入（`animate-in fade-in slide-in-from-bottom-2`）

### Requirement: /facilitate 页减少红色
所有 `destructive` 颜色 SHALL 按严重度重新分级：
- **保留红色**（最严重）：仅 1 处——"诊断问题"页面跳转按钮或严重警告 toast
- **改用 amber/orange**（次严重）：attention tag、warning hint、"需重点突破"标识
- **改用 primary/blue**（中性提示）：卡片标题、未完成 tab 角标
- **改用 muted**（次要）：辅助说明、过期内容、skeleton

#### Scenario: 配色合规
- **WHEN** 视觉走查 /facilitate
- **THEN** 红色元素出现次数 ≤ 1 处
- **AND** amber 出现次数 ≤ 3 处
- **AND** 整体视觉 SHALL 偏向蓝/绿/中性

### Requirement: /report API 错误处理修复
report 页 SHALL：
- 当 `res.ok = false` 时显示**错误状态卡片**而非"暂无..."占位
- 错误卡片 SHALL 区分：404（任务不存在/已删除）/ 500（服务器错误）/ 网络错误
- SHALL 提供"重试"按钮 + "返回列表"按钮
- 错误信息 SHALL 中文友好（不要直接显示英文 error）

#### Scenario: 404 错误
- **WHEN** `/api/report/${scenarioId}` 返回 404
- **THEN** 报告页 SHALL 显示"该学习记录已过期或被删除"
- **AND** 提供"返回学习记录列表"按钮

#### Scenario: 网络错误
- **WHEN** fetch 抛出异常（TypeError）
- **THEN** 报告页 SHALL 显示"网络异常，请检查连接后重试"
- **AND** 提供"重试"按钮（点击重新 fetch）

#### Scenario: 500 错误
- **WHEN** 后端返回 500
- **THEN** 报告页 SHALL 显示"报告生成出错，请稍后重试"
- **AND** 保留 console.error 详情

## MODIFIED Requirements

### Requirement: AI 诊断 prompt 扩展
原 `analyze_diagnose` prompt 补充：
- 每个 gap 增加 `reference_expression` 字段（必填，最自然的英文正确表达）
- 整个诊断增加 `high_freq_errors` 数组（phrase-level 错误，1-3 条）

新 prompt 模板：
```
... (原 gaps 结构)
每个 gap 包含：
- label: 简短不足标签
- evidence_sentence: 你在对话中实际说出的原句
- reference_expression: 建议的参考表达（更自然/准确的英文）
- explanation: 为什么这样更好

整体增加：
- high_freq_errors: 高频错误短语列表，每条 {phrase, occurrence, suggestion}
```

### Requirement: 诊断页数据存储扩展
attempt1 提交后，`localStorage.diagnosis` SHALL 存储扩展对象：
```ts
{
  gaps: GapItem[],  // 已有
  high_freq_errors: {phrase, occurrence, suggestion}[]  // 新增
}
```

diagnosis/page.tsx useEffect SHALL 兼容三种格式：
- 旧格式：`data` 是 gap 数组
- 新格式 A：`{gaps: [], high_freq_errors: []}`
- 新格式 B：`{gaps: []}` （无 high_freq_errors）

## REMOVED Requirements

无删除项

## 设计权衡记录

| 决策 | 备选 | 选用理由 |
|------|------|----------|
| InlineLoadingHint 单独组件 vs 各页面写死 | 各页面写死 | 多处复用，统一文案轮换逻辑 |
| 高频错误提取在 attempt1 submit 同步调用 | 异步 Celery | 单次 LLM 调用 < 5s 不会拖慢主流程 |
| reference_expression 在 LLM 中生成 | 数据库预存 | gap 来自不同用户不同 attempt，无法预存 |
| report 错误时显示错误卡片 | 静默降级 | 静默降级让用户误以为数据丢失 |
| 红色仅保留 1 处 | 完全去掉 | 完全去掉会失去最严重警告的视觉张力 |

## 验收标准

- [ ] 诊断页 gap 卡片有"原句 vs 参考表达"对照栏
- [ ] 诊断页标题下有"高频错误"摘要区块（≤ 3 个 tag）
- [ ] /facilitate 各 tab 加载中显示"稍等，AI 正在快马加鞭整理..."轮换提示
- [ ] /evaluate 各 section 加载中显示内联提示
- [ ] /facilitate 红色元素 ≤ 1 处
- [ ] /report API 404/500/网络错误时显示友好错误卡片 + 重试按钮
- [ ] `npm run build` exit 0
- [ ] 后端模型 import OK
- [ ] DB 已迁移：Gap 表新增 `reference_expression` 和 `high_freq_errors` 字段
