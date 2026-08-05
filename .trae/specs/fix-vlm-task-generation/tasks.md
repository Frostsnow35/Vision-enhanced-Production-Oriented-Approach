# Tasks: 修复 VLM 场景分析 → 交际任务生成

## Task 1: 后端 — 移除硬编码 API Key + 取消 Mock 兜底 + 详细日志
- [x] 修改 `config.py`：`DOUBAO_API_KEY` 默认值改为空字符串 `""`，仅从 `os.getenv("DOUBAO_API_KEY", "")` 读取
- [x] 修改 `services/ai_service.py` 的 `analyze_scenario()`：
  - 在函数开头检查 API Key，为空则**抛出 HTTPException(503)** 而非返回 Mock
  - 文件不存在时**抛出 HTTPException(400)** 而非返回 Mock
  - API 调用失败时**抛出 HTTPException(502/503)**，携带结构化错误信息（`error_type` + `message` + `detail` + `suggestion`）
  - JSON 解析失败时**抛出 HTTPException(502)**，携带原始文本前 300 字符
  - 成功时正常返回
- [x] 在 `analyze_scenario()` 中增加详细请求/响应日志：
  - 记录请求开始时间、API 端点 URL、模型 ID
  - 记录 HTTP 状态码、响应耗时（ms）
  - 成功时记录响应体前 500 字符
  - 失败时记录完整错误信息和异常堆栈
- [x] 删除 `_MOCK_SCENARIO_RESULT` 常量及相关降级逻辑
- [x] 验证: 不设置 `DOUBAO_API_KEY` 启动后端，调用 `POST /api/scenario/analyze` 返回 503 结构化错误 ✅ (HTTP 400 for file_not_found, 503 for api_key_missing)

## Task 2: 后端 — 新增错误响应 Schema + VLM 健康检查端点
- [x] 修改 `schemas.py`：新增 `ErrorDetail` schema 和 `VLMHealthResponse` schema
- [x] 在 `routers/scenario.py` 中新增 `GET /api/scenario/health` 端点
- [x] 验证: `curl http://localhost:9000/api/scenario/health` 返回 `{"vlm_available": false, "error_type": "api_key_missing"}` ✅

## Task 3: 后端 — 优化 System Prompt
- [x] 修改 `services/ai_service.py` 中的 `_SYSTEM_PROMPT`：移除所有诱导性场景示例
- [x] 验证: 代码审查 Prompt 内容，确认无诱导示例 ✅

## Task 4: 前端 — API 层错误处理
- [x] 修改 `src/lib/api.ts` 的 `analyzeScenario()`：直接发送 fetch 请求，解析结构化错误
- [x] 新增 `VLMError` 类型定义
- [x] 验证: TypeScript 编译零错误 ✅

## Task 5: 前端 — 场景页进度状态 + 错误展示
- [x] 修改 `src/app/scenario/page.tsx` 的 `handleGenerate()`：
  - 提交中：按钮文案变更为动态阶段文案（"正在上传图片…"→"AI 正在分析图片…"）
  - 成功：Toast 提示 + 0.6 秒后跳转 `/task`
  - 失败：Toast Error 展示带错误类型中文映射的详情，不跳转
- [x] 验证: TypeScript 编译零错误 ✅

## Task 6: 端到端验证
- [x] 后端所有导入正常 (`py -c` 测试通过)
- [x] `GET /api/scenario/health` 返回正确状态
- [x] `POST /api/scenario/analyze` 不存在的文件返回 HTTP 400 + 结构化错误
- [x] TypeScript 编译零错误
- [ ] 正确配置 `DOUBAO_API_KEY` 后验证真实 VLM 调用（需要有效的 API Key）

# Task Dependencies
- Task 2 依赖 Task 1 ✅
- Task 4 依赖 Task 1/2 ✅
- Task 5 依赖 Task 4 ✅
- Task 6 依赖 Task 1-5 ✅
- Task 1 和 Task 3 可并行执行 ✅
