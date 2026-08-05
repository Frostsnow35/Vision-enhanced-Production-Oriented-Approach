# Checklist

- [x] `generate_reply` 的 system message 包含 "SECOND attempt" 上下文（当 is_variant=True 时）
- [x] `generate_opening` 的变体开场 prompt 体现二次尝试语境
- [x] attempt1 对话中 AI 不显示二次尝试上下文（is_variant=False）
- [x] evaluate 页"查看完整学习证据链"按钮使用动态 scenarioId 而非硬编码 `1`
- [x] attempt1 气泡列表中，turn_feedback 维度和评论显示在用户消息下方
- [x] attempt2 气泡列表中，turn_feedback 维度和评论显示在用户消息下方
- [x] 无 turn_feedback 时用户气泡下方无冗余空白
- [x] 提交诊断时 attempt_text 包含 `[你]:` / `[AI]:` 说话人标记
- [x] 后端 diagnose_attempt 收到的文本能区分学生和 AI 的对话
- [x] report 页 EvaluationContent 展示每个维度的 attempt1 分数、attempt2 分数、变化量
- [x] report 页维度按变化量降序排列
- [x] evaluate 页跳转到 report 的 scenarioId 与实际一致
- [x] handleSubmit 将 audio_urls 传给 POST /api/attempt1/submit
- [x] 后端 attempt1_submit 将 audio_urls 解析为路径后传给 evaluate_single
- [x] evaluate_single 收到非空 audio_paths 时执行发音和流利度分析
