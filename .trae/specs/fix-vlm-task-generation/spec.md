# 修复 VLM 场景分析 → 交际任务生成 规范

## Why

无论上传什么图片，后端始终返回咖啡店点单的 Mock 数据（`_MOCK_SCENARIO_RESULT`）。豆包视觉模型（VLM）调用链路失败后静默降级，前端和用户完全不知情。用户的诊断是对的：模型没有对上传图片进行真正的分析和推理。本规范要求 **取消 Mock 兜底策略**，VLM 调用失败时直接向前端报告错误类型与详情。

## What Changes

- **取消 Mock 兜底**：`analyze_scenario()` 不再在失败时返回 Mock 数据，而是抛出错误/返回错误信息
- **后端结构化错误返回**：定义错误类型枚举（`api_key_missing` / `network_error` / `model_timeout` / `http_error` / `json_parse_error` / `file_not_found`），向前端返回具体错误类型、错误码和人类可读的详情
- **增加 VLM 连通性自检端点** `GET /api/scenario/health`，方便本地调试
- **后端记录详细日志**：每次 API 调用的请求/响应详情（请求耗时、HTTP 状态码、响应体摘要）
- **前端展示具体错误**：在 `/scenario` 页面展示"AI 分析中…"进度状态；失败时展示错误类型和详情，而非静默跳转
- **优化 System Prompt**：移除诱导性示例（如"咖啡厅"），避免 VLM 倾向于特定场景
- **安全改进**：将硬编码在 `config.py` 中的 API Key 移除，仅从环境变量读取

## Impact

- **BREAKING**: 前端 `/scenario` → `/task` 流程在 VLM 不可用时不再自动跳转，用户需手动重试或知道出了什么问题
- Affected code:
  - **后端**: `config.py`（API Key 安全化）、`services/ai_service.py`（VLM 调用重构 + 错误返回 + 日志 + Prompt 优化）、`routers/scenario.py`（health 端点 + 错误响应处理）、`schemas.py`（新增错误响应 schema）
  - **前端**: `src/lib/api.ts`（错误类型扩展 + 响应处理）、`src/app/scenario/page.tsx`（进度状态 + 错误展示）、`src/lib/store.tsx`（无需新增字段）

## ADDED Requirements

### Requirement: VLM 调用失败时返回结构化错误（非 Mock）
系统 SHALL 在 VLM API 调用链路的任意环节失败时，返回结构化错误给前端，包含明确的错误类型和详情，而非降级返回 Mock 数据。

#### Scenario: API Key 未配置
- **WHEN** `DOUBAO_API_KEY` 环境变量为空
- **THEN** `POST /api/scenario/analyze` 返回 HTTP 503，body 为：
```json
{
  "detail": {
    "error_type": "api_key_missing",
    "message": "豆包 API Key 未配置，请在环境变量中设置 DOUBAO_API_KEY",
    "suggestion": "请检查 .env 文件或服务器环境变量"
  }
}
```

#### Scenario: 网络请求超时
- **WHEN** VLM API 请求超过 30 秒未响应
- **THEN** `POST /api/scenario/analyze` 返回 HTTP 503，body 为：
```json
{
  "detail": {
    "error_type": "network_timeout",
    "message": "豆包视觉模型请求超时（超过 30 秒未响应）",
    "detail": "Request timed out after 30.0s",
    "suggestion": "请稍后重试，或检查网络连接"
  }
}
```

#### Scenario: VLM 返回非 200 状态码
- **WHEN** VLM API 返回 HTTP 4xx/5xx
- **THEN** `POST /api/scenario/analyze` 返回 HTTP 502，body 包含 `error_type: "http_error"`、HTTP 状态码和响应体摘要

#### Scenario: VLM 返回内容 JSON 解析失败
- **WHEN** VLM 返回了文本但无法解析为 JSON
- **THEN** `POST /api/scenario/analyze` 返回 HTTP 502，body 包含 `error_type: "json_parse_error"` 和原始文本前 300 字符

#### Scenario: 图片文件不存在
- **WHEN** 传入的 `image_path` 在服务器上找不到对应文件
- **THEN** `POST /api/scenario/analyze` 返回 HTTP 400，body 包含 `error_type: "file_not_found"`

#### Scenario: VLM 调用成功
- **WHEN** VLM API 调用成功并正确解析 JSON
- **THEN** 返回 HTTP 200，body 包含完整 `ScenarioAnalyzeResponse`

### Requirement: VLM API 连通性自检端点
系统 SHALL 提供 `GET /api/scenario/health` 端点，用于检查豆包视觉模型 API 是否可用。

#### Scenario: API 可用
- **WHEN** 访问 `/api/scenario/health`
- **THEN** 返回 `{ "vlm_available": true, "model": "...", "latency_ms": 1234 }`

#### Scenario: API 不可用
- **WHEN** VLM 不可达
- **THEN** 返回 `{ "vlm_available": false, "error_type": "...", "detail": "..." }`

### Requirement: 前端展示分析进度与错误详情
前端 `/scenario` 页面 SHALL 在生成任务时展示进度指示，并在失败时展示错误类型和详情。

#### Scenario: 分析中
- **WHEN** 用户点击"生成交际任务"
- **THEN** 按钮文案变为"AI 正在分析图片…"，出现加载动画，按钮禁用

#### Scenario: VLM 调用失败
- **WHEN** 后端返回 HTTP 4xx/5xx 错误
- **THEN** 页面展示 Toast Error，包含错误类型（中文对应）和详情信息；按钮恢复可用；**不跳转** 到 `/task`
- Toast 示例: "AI 服务不可用：豆包 API Key 未配置 → 请在 .env 中设置 DOUBAO_API_KEY"

#### Scenario: VLM 调用成功
- **WHEN** 后端返回 HTTP 200
- **THEN** Toast 提示"场景分析完成，正在跳转…"，0.6 秒后自动跳转到 `/task`

### Requirement: API Key 仅从环境变量读取
系统 SHALL 仅从环境变量 `DOUBAO_API_KEY` 读取 API Key，不得在代码中硬编码默认值。

#### Scenario: 环境变量未设置
- **WHEN** `DOUBAO_API_KEY` 环境变量为空
- **THEN** 不发起 VLM HTTP 请求，直接返回 `error_type: "api_key_missing"`

## MODIFIED Requirements

### Requirement: VLM System Prompt 不包含场景示例诱导
System Prompt SHALL 仅描述 JSON 输出格式和字段说明，移除具体场景示例。

#### Scenario: 上传图书馆照片
- **WHEN** 用户上传一张图书馆照片且 VLM 正常工作
- **THEN** `scene_label` 应是图书馆相关，而非咖啡店

### Requirement: VLM 调用详细日志
每次 VLM API 调用 SHALL 记录：
- 请求开始时间、API 端点完整 URL、模型 ID
- HTTP 状态码、响应耗时（毫秒）
- 响应体前 500 字符
- 失败时的完整错误信息和异常堆栈

## REMOVED Requirements

### Requirement: Mock 兜底降级策略
**Reason**: 用户要求模型服务不可用时直接报错而非静默降级，避免给用户造成"系统运行正常"的假象。
**Migration**: 前端在调用失败时展示错误详情，不再自动跳转 `/task`。
