# 修复 Railway 部署 failed to fetch + 豆包模型 ID 错误 Spec

## Why
1. **Railway 部署 "failed to fetch"**：`api.ts` 中 `BASE_URL` 默认为 `http://localhost:8000`，在 Railway 中 localhost:8000 不存在，前端 fetch 直接失败。Next.js 已有 `/api/:path*` rewrite 规则，但 `api.ts` 用绝对 URL 绕过了 rewrite。
2. **豆包 VLM 模型 ID 错误**：`config.py` 中 `ARK_MODEL_ID = "doubao-1.5-vision-pro-32k"` 不是火山方舟的有效模型 ID。查阅官方文档和多个教程确认，正确 ID 为 `doubao-1.5-vision-pro-250328`。模型 ID 错误导致 VLM 调用失败，无法识别图片。

## What Changes
- **BREAKING** `api.ts`：移除 `BASE_URL` 绝对地址，改用相对路径 `/api/...`，让 Next.js rewrite 统一代理
- `config.py`：修正 `ARK_MODEL_ID` 为 `doubao-1.5-vision-pro-250328`
- `poa-backend/railway.toml`：新增 Railway 部署配置，指定构建和启动命令
- `poa-frontend/next.config.ts`：`BACKEND_URL` 改用服务端环境变量 `RAILWAY_BACKEND_URL` 或 `BACKEND_URL`，不再使用 `NEXT_PUBLIC_` 前缀（因为 rewrite 在服务端执行）

## Impact
- Affected code: `poa-frontend/src/lib/api.ts`、`poa-backend/config.py`、`poa-backend/railway.toml`（新增）、`poa-frontend/next.config.ts`

## ADDED Requirements

### Requirement: 前端 API 请求使用相对路径
前端 `api.ts` SHALL 使用相对路径（如 `/api/scenario/analyze`）发起请求，不再使用绝对 URL。请求经由 Next.js 同源发出，由 `next.config.ts` 的 rewrite 规则代理到后端。

#### Scenario: Railway 部署环境
- **WHEN** 前端部署在 Railway（域名如 `xxx.railway.app`）  
- **AND** 用户点击"生成交际任务"
- **THEN** `fetch("/api/scenario/analyze")` 发往 `https://xxx.railway.app/api/scenario/analyze`
- **AND** Next.js rewrite 将其代理到后端服务

#### Scenario: 本地开发环境
- **WHEN** 前端运行在 `localhost:3000`，后端运行在 `localhost:8000`
- **THEN** `fetch("/api/scenario/analyze")` 发往 `http://localhost:3000/api/scenario/analyze`
- **AND** Next.js rewrite 将其代理到 `http://localhost:8000/api/scenario/analyze`

### Requirement: 豆包 Vision 模型 ID 正确
`config.py` 中 `ARK_MODEL_ID` SHALL 使用火山方舟官方发布的模型 ID `doubao-1.5-vision-pro-250328`。

#### Scenario: VLM 场景分析成功
- **WHEN** 后端调用豆包 Vision API 分析照片
- **THEN** 请求体 `model` 字段为 `doubao-1.5-vision-pro-250328`
- **AND** 火山方舟正确识别模型并返回场景分析结果

### Requirement: Railway 部署配置
`poa-backend/` SHALL 包含 `railway.toml`，指定正确的构建和启动命令。

#### Scenario: Railway 自动部署后端
- **WHEN** Railway 检测到 `poa-backend/` 目录变更
- **THEN** 按 `railway.toml` 配置执行构建和启动

## MODIFIED Requirements

### Requirement: next.config.ts 后端 URL 配置
`next.config.ts` 中 `BACKEND_URL` SHALL 从 `BACKEND_URL` 或 `RAILWAY_BACKEND_URL` 环境变量读取（服务端变量），默认值为 `http://localhost:8000`。

#### Scenario: Railway 中 rewrite 代理生效
- **WHEN** Railway 设置环境变量 `BACKEND_URL=https://xxx-backend.railway.app`
- **THEN** `next.config.ts` rewrite 将 `/api/:path*` 代理到正确的后端服务