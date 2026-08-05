# Checklist

- [x] Task 1: Button组件使用原生button元素，`npm run build`无"Module not found: @base-ui/react/button"错误
- [x] Task 1: 所有页面中Button组件渲染正常，variant/size样式正确
- [x] Task 2: Task页面显示"变体挑战"区块（variant_plot存在时）
- [x] Task 2: 变体挑战入口可跳转attempt2并传递variant_context到localStorage
- [x] Task 2: Attempt2的AI对话使用变体情节驱动（start + turn 均已传递variant_context）
- [x] Task 3: Facilitate页面新增"口语练习"Tab，显示示范句式列表
- [x] Task 3: 口语练习支持播放TTS→录音→回听对比流程
- [x] Task 3: 完成2句跟读后Tab标记为completed
- [x] Task 4: Facilitate评估Tab使用完整对话文本调用/api/evaluate-single
- [x] Task 4: attempt1已写入conversationText到localStorage
- [x] Task 5: 首页展示学习旅程仪表盘（有journey数据时）
- [x] Task 5: 首页无数据时显示引导状态
- [x] Task 6: VLM prompt包含opening_question和强化evaluation_criteria要求
- [x] Task 6: 各核心页面刷新后数据正确恢复（git checkout恢复原始正确文件）
- [x] 全流程构建验证：npm run build 通过（exit code 0，全部13个路由成功生成）
