# Checklist: 修复 VLM 场景分析 → 交际任务生成

- [x] `config.py` 中 `DOUBAO_API_KEY` 无硬编码默认值，仅从环境变量读取
- [x] `analyze_scenario()` 中已删除 `_MOCK_SCENARIO_RESULT` 及所有 Mock 降级逻辑
- [x] API Key 为空时返回 HTTP 503，body 包含 `error_type: "api_key_missing"`, `message`, `suggestion`
- [x] 图片文件不存在时返回 HTTP 400，body 包含 `error_type: "file_not_found"`
- [x] VLM API 网络错误/超时时返回 HTTP 503，body 包含 `error_type: "network_error"` / `"network_timeout"`
- [x] VLM API 返回非 200 时返回 HTTP 502，body 包含 `error_type: "http_error"` 和上游状态码
- [x] VLM 返回 JSON 解析失败时返回 HTTP 502，body 包含 `error_type: "json_parse_error"` 和原始文本摘要
- [x] 每次 VLM 调用均有详细日志：端点 URL、模型 ID、耗时、状态码、响应摘要
- [x] `GET /api/scenario/health` 端点存在且能正确报告 VLM 连通性
- [x] `_SYSTEM_PROMPT` 中已移除所有诱导性场景示例
- [x] 前端 `analyzeScenario()` 能从错误响应中提取 `error_type` / `message` / `suggestion`
- [x] 前端 `/scenario` 页面提交中展示动态进度状态（"正在上传图片…" / "AI 正在分析图片…"）
- [x] 前端 VLM 调用失败时展示具体错误信息，不跳转 `/task`
- [ ] 正确配置 API Key 后上传非咖啡店图片，任务场景与图片内容匹配（需有效 API Key）
