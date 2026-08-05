# 修复 /api/scenario/analyze 404 错误 Spec（第二次）

## Why
场景驱动页面"生成交际任务"仍返回 404。上次修复提交到了 `poa-project/` 子目录，但合并后代码回退到 `e:\V-POA\poa-backend\` 和 `e:\V-POA\poa-frontend\`，所有修复丢失。此外 `main.py` 缺少 3 个路由注册（facilitate / exercise / chat），导致更多 API 端点不可达。

## What Changes
- 修复 `poa-frontend/next.config.ts` 默认后端端口 `8001` → `8000`
- 修复 `poa-frontend/src/lib/api.ts` 中 `BASE_URL` 默认值 `""` → `"http://localhost:8000"`
- 创建 `poa-frontend/.env.local`，声明 `NEXT_PUBLIC_API_BASE=http://localhost:8000`
- 在 `poa-backend/main.py` 中注册缺失的 3 个路由：`facilitate_router`、`exercise_router`、`chat_router`
- 在 `poa-backend/main.py` 中补充 `uploads/tts` 目录创建和 `uploads` 静态文件挂载
- 清除 `poa-backend/routers/attempt.py` 中与 `facilitate.py` 重复的 `/generate-input-pack` 和 `/generate-exercises` 路由

## Impact
- Affected code: `poa-frontend/next.config.ts`、`poa-frontend/src/lib/api.ts`、`poa-frontend/.env.local`、`poa-backend/main.py`、`poa-backend/routers/attempt.py`

## ADDED Requirements

### Requirement: 前后端端口一致性
前端 `next.config.ts` rewrite 规则和 `api.ts` 的 `BASE_URL` SHALL 默认指向 `http://localhost:8000`，与后端 FastAPI 实际运行端口一致。

#### Scenario: 前端调用 /api/scenario/analyze
- **WHEN** 前端调用 `analyzeScenario(imagePath)`
- **AND** `NEXT_PUBLIC_API_BASE` 未设置
- **THEN** 请求到达 `http://localhost:8000/api/scenario/analyze`
- **AND** 后端正确响应场景分析结果

### Requirement: 后端路由完整性
`main.py` SHALL 注册所有已实现的路由模块（upload / scenario / attempt / evaluate / facilitate / exercise / chat），确保前端调用的每个 API 端点都有对应的后端处理。

#### Scenario: 前端调用促成学习 API
- **WHEN** 前端调用 `POST /api/generate-input-pack`
- **THEN** 请求由 `facilitate_router` 处理并返回学习材料包

### Requirement: 路由去重
`attempt.py` 与 `facilitate.py` 中重复注册的 `/generate-input-pack` 和 `/generate-exercises` 端点 SHALL 仅保留 `facilitate.py` 中的版本，从 `attempt.py` 中移除。

#### Scenario: 调用学习材料生成
- **WHEN** 前端调用 `POST /api/generate-input-pack`
- **THEN** 仅由 `facilitate_router` 处理请求
- **AND** 不存在路由歧义
