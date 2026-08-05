# Tasks

- [x] Task 1: 修复 @base-ui/react/button 模块解析失败
  - [x] 将button.tsx中`import { Button as ButtonPrimitive } from "@base-ui/react/button"`替换为原生`<button>`元素类型
  - [x] 保持cva变体样式系统不变
  - [x] 验证构建：`npm run build` 无 "Module not found" 错误（并修复了5个额外文件的语法错误）
  - [x] 验证Button组件在各页面中渲染正常

- [x] Task 2: 变体情节Task页面展示 + Attempt2变体驱动
  - [x] 在task/page.tsx的任务卡中新增"变体挑战"区块（当variant_plot存在时显示）
  - [x] 新增变体挑战入口："挑战变体情节"按钮，点击后设置variantContext到localStorage并跳转attempt2
  - [x] attempt2/page.tsx已支持variant_context传递给chat API
  - [x] variant数据存入localStorage（key: "variantContext"）
  - [x] 验证：构建通过

- [x] Task 3: 促成学习口语练习Tab（跟读/朗读）
  - [x] 在facilitate/page.tsx新增"oral"Tab（口语练习）
  - [x] 实现跟读组件（OralTab）：展示示范句式 → 播放TTS → 用户录音 → 回听对比
  - [x] 复用现有MediaRecorder逻辑
  - [x] 学习进度追踪（至少2句完成标记Tab为completed）
  - [x] Tab权重自动均分（5个Tab各20%）

- [x] Task 4: 修复促成学习能力评估文本传递 + TTS优化
  - [x] 从localStorage读取完整conversationText传递给/api/evaluate-single
  - [x] 降级策略：若完整文本不可用，使用evidence_sentence拼接
  - [x] 修复facilitate页面中的JSX语法错误
  - [x] 示范对话TTS逐句播放功能正常

- [x] Task 5: 首页学习旅程仪表盘
  - [x] 在app/page.tsx实现仪表盘布局（学习记录卡片列表）
  - [x] 展示最近学习记录卡片（场景标签、任务标题、分数圆环、完成时间）
  - [x] 七维趋势迷你可视化（MiniDimBars组件：双进度条+变化量）
  - [x] 无数据时显示引导状态
  - [x] 卡片点击导航到/scenario

- [x] Task 6: 优化VLM任务生成Prompt + 刷新恢复逻辑
  - [x] 增强_SCENE_PROMPT：增加opening_question要求（第7条）+ 强化evaluation_criteria禁止通用维度
  - [x] 交际类型多样性已包含在prompt（6种类型随机选）
  - [x] 各核心页面刷新恢复逻辑已通过git checkout恢复正确文件后确认一致性

# Task Dependencies
- Task 1 无依赖 → 已完成
- Task 2 依赖 Task 1 → 已完成
- Task 3 依赖 Task 1 → 已完成（与Task4合并）
- Task 4 依赖 Task 1 → 已完成
- Task 5 依赖 Task 1 → 已完成
- Task 6 独立 → 已完成
