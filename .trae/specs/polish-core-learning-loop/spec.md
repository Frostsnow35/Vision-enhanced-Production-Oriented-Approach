# POA核心学习闭环打磨 Spec

## Why
当前POA学习闭环（场景→任务→尝试1→诊断→促成→尝试2→评价→报告）的功能骨架已搭建完成，但各环节存在多个影响学习效果和用户体验的问题：任务生成中变体情节未被利用、促成学习中缺乏口语练习、能力评估文本传递有缺陷、首页缺少学习旅程仪表盘、以及`@base-ui/react/button`模块解析失败导致构建失败。需要系统性地修复和增强这些核心环节。

## What Changes
- **修复** `@base-ui/react/button` 模块解析失败（替换为原生button，包本身有bug）
- **新增** 变体情节（variant_plot）在Task页面的展示，attempt2使用变体情节驱动对话
- **新增** 促成学习中口语跟读/朗读练习，与现有选择题形成互补
- **修复** 促成学习能力评估Tab的文本传递缺陷（用gap的evidence_sentence拼接→改用完整对话原文）
- **优化** 示范对话TTS逐句播放体验
- **新增** 首页学习旅程仪表盘（历史记录、进度概览、维度趋势）
- **增强** 任务生成VLM prompt（优化场景多样性与任务具体性）
- **修复** 各页面刷新/重新进入时的数据恢复逻辑一致性问题

## Impact
- Affected specs: task-generation, facilitate, evaluate, report
- Affected code: 
  - `poa-frontend/src/components/ui/button.tsx` — **BREAKING** 移除@base-ui/react依赖
  - `poa-frontend/src/app/task/page.tsx` — 新增变体情节展示
  - `poa-frontend/src/app/attempt1/page.tsx` — 支持变体上下文传递
  - `poa-frontend/src/app/attempt2/page.tsx` — 使用变体情节
  - `poa-frontend/src/app/facilitate/page.tsx` — 新增口语练习Tab + 修复评估文本
  - `poa-frontend/src/app/page.tsx` — 新增学习旅程仪表盘
  - `poa-frontend/src/lib/store.tsx` — 扩展状态类型
  - `poa-backend/services/ai_service.py` — 优化VLM prompt
  - `poa-backend/services/chat_service.py` — 支持变体上下文

## ADDED Requirements

### Requirement: 变体情节Task展示
系统SHALL在任务卡页面展示变体情节（variant_plot），让用户了解attempt2将采用的不同情节。Attempt2的AI对话SHALL使用变体情节驱动而非复用attempt1的同一任务。

#### Scenario: 用户在Task页查看变体情节
- **WHEN** 用户进入/task页面且task数据包含variant_plot字段
- **THEN** 任务卡中显示"变体挑战"区块，展示变体情节描述
- **AND** 页面底部显示两个入口按钮："开始初次产出"和"直接进入变体挑战"

#### Scenario: Attempt2使用变体情节
- **WHEN** 用户在attempt2页面发起AI对话
- **THEN** 后端chat/start API接收variant_context参数
- **AND** AI开场白和后续回复基于变体情节生成，而非重复主任务

### Requirement: 促成学习口语练习
系统SHALL在促成学习模块中提供口语跟读/朗读练习，让学生实际开口训练而非仅做选择题。

#### Scenario: 口语跟读练习
- **WHEN** 用户进入facilitate页面的"口语练习"Tab
- **THEN** 显示示范句式列表，每条配有播放按钮和录音按钮
- **AND** 用户可听示范发音、录音跟读、回听对比

#### Scenario: 口语练习完成标记
- **WHEN** 用户完成至少2句跟读录音
- **THEN** Tab标记为"completed"

### Requirement: 首页学习旅程仪表盘
系统SHALL在首页展示用户的学习旅程概览，包括历史评估记录、各维度进步趋势和最近学习活动。

#### Scenario: 首页仪表盘展示
- **WHEN** 用户进入首页且localStorage中存在journey数据
- **THEN** 展示最近完成的学习记录卡片
- **AND** 展示七维能力趋势迷你图
- **AND** 每个卡片可点击跳转到对应场景

#### Scenario: 无数据时的仪表盘状态
- **WHEN** 用户首次访问首页无任何学习记录
- **THEN** 显示引导文案，提示"开始你的第一次实景口语练习"
- **AND** 提供快捷入口按钮跳转到/scenario

## MODIFIED Requirements

### Requirement: Button组件
Button组件SHALL使用原生HTML `<button>` 元素替代 `@base-ui/react/button`，保持与shadcn/cva的样式系统兼容。

#### Scenario: Button正常渲染
- **WHEN** 页面中任何使用Button组件的地方
- **THEN** Button正常渲染且样式与之前一致
- **AND** 所有variant/size变体正常工作
- **AND** 构建不再报"Module not found"错误

### Requirement: 促成学习能力评估
促成学习页的能力评估Tab SHALL传递完整对话原文（而非gap的evidence_sentence拼接）给评估API，以获得更准确的评估结果。

#### Scenario: 评估文本传递
- **WHEN** facilitate页面加载能力评估数据
- **THEN** 从localStorage读取完整对话记录（conversationText/conversationText2）
- **AND** 将完整对话文本传递给/api/evaluate-single
- **AND** 若对话文本不可用，降级使用evidence_sentence拼接

### Requirement: 示范对话TTS
示范对话Tab SHALL支持用户点击播放按钮，使用浏览器内置SpeechSynthesis API逐句朗读对话内容。

#### Scenario: 逐句播放对话
- **WHEN** 用户点击示范对话中某句旁边的播放按钮
- **THEN** 使用SpeechSynthesis朗读该句英文
- **AND** 播放时按钮显示"播放中"动画状态
- **AND** （已有功能，确认正常运行）

### Requirement: 刷新恢复逻辑
各核心页面（task、attempt1、diagnosis、facilitate、evaluate）SHALL在页面刷新后正确恢复学习数据，不丢失上下文。

#### Scenario: 刷新后数据恢复
- **WHEN** 用户在任何学习环节刷新页面
- **THEN** 页面从localStorage恢复当前任务和诊断数据
- **AND** 若无历史数据，显示HistoryTaskSelector让用户选择
- **AND** 若既无历史也无会话标记，引导用户回到场景页

## 设计参考（来自成熟产品对比）

基于对Duolingo Video Call、ELSA Speak、TalkEasy、Praktika等产品的分析：

1. **Duolingo的4段式对话结构**（Opener → First Question → Conversation → Closer）：我们已部分实现（开场白→对话→完成标记），但缺少明确的"第一个引导性问题"。建议增强开场白prompt使其包含具体的引导提问。

2. **ELSA Speak的音素级评分（0-100分）**：我们已有7维评分体系（1-5分），维度设计更贴合POA理论。建议在报告页增加总分和趋势可视化。

3. **TalkEasy的Task-Based Learning定位**：与我们的POA任务驱动思路高度一致。其"个性化学习计划+即时反馈+进度追踪"三角模型可作为我们首页仪表盘的设计参考。

4. **AI-ESL研究的BOPPPS框架**（Bridge-in, Objective, Pre-assessment, Participatory Learning, Post-assessment, Summary）：我们的POA流程（场景驱动→任务→尝试→诊断→促成→再尝试→评价→报告）天然覆盖了BOPPPS各环节，但缺少明确的"Bridge-in"（热身导入）环节。
