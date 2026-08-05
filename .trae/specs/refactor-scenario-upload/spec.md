# 场景驱动模块重构 —— 取消样例库，纯本地上传 Spec

## Why
1. **Upload 500**：`/api/upload/image` 可能因缺少 `uploads/` 目录或其它运行时异常返回 500。
2. **Scenario analyze 500**：`/api/scenario/analyze` 接收到上传返回的相对路径 `uploads/images/xxx.jpg` 后，用相对路径 `open()` 读取文件。在 Railway 部署环境中 `os.getcwd()` 可能不是项目根目录，导致文件读取失败 → 降级 Mock（用户看不到图片识别结果）；最坏情况直接 500。
3. **需求变更**：取消模板样例照片库，仅保留本地上传功能。用户上传真实照片 → VLM 图像识别场景 → 自动生成交际任务。

## What Changes
- **BREAKING** 移除前端 `/scenario` 页面的"样例照片库"Tab、`SAMPLE_PHOTOS` 数据、`SampleGrid` 组件、`SceneIcon` 组件
- **BREAKING** 移除前端 `next.config.ts` 中 `/samples/:path*` rewrite 规则
- **BREAKING** 移除后端 `main.py` 中 `/samples` 静态文件挂载和 `sample_images/` 目录创建
- 修复 `upload.py`：上传成功前确保目录存在（加 `os.makedirs(save_dir, exist_ok=True)` 兜底）
- 修复 `scenario.py`：处理上传返回的相对路径，正确解析为绝对路径后再传给 VLM
- 修复 `api.ts`：确保错误信息正确传递到前端

## Impact
- Affected specs: fix-railway-404, fix-scenario-analyze-404（无直接冲突）
- Affected code:
  - `poa-frontend/src/app/scenario/page.tsx` — 移除样例库相关代码，简化为纯上传页
  - `poa-frontend/next.config.ts` — 移除 `/samples/:path*` rewrite
  - `poa-frontend/src/lib/api.ts` — 确保 upload/analyze 错误处理健壮
  - `poa-backend/main.py` — 移除 `/samples` 挂载和 `sample_images/` 目录创建
  - `poa-backend/routers/upload.py` — 强化目录存在性保证
  - `poa-backend/routers/scenario.py` — 修复上传路径解析

## REMOVED Requirements

### Requirement: 样例照片库
**Reason**: 需求变更，仅保留本地上传功能。
**Migration**: 删除 `SAMPLE_PHOTOS` 常量、`SampleGrid` 组件、`SceneIcon` 组件、Tab 切换 UI。

### Requirement: /samples 静态文件服务
**Reason**: 样例照片库移除后不再需要。
**Migration**: 移除 `main.py` 中 `/samples` mount + `sample_images/` 创建，移除 `next.config.ts` 中 `/samples/:path*` rewrite。

## MODIFIED Requirements

### Requirement: 本地上传路径健壮性
`upload.py` SHALL 在上传文件写入前确保目标目录存在（`os.makedirs`），并返回相对于 `/uploads` 挂载点的 URL。

#### Scenario: 上传成功
- **WHEN** 用户拖拽或选择一张 JPG/PNG 图片
- **THEN** 图片保存到 `uploads/images/{uuid}.{ext}`
- **AND** 返回 `image_url` 为 `uploads/images/{uuid}.{ext}`（前端可通过 `GET /uploads/images/{uuid}.{ext}` 访问）
- **AND** HTTP 状态码 200

#### Scenario: 上传目录不存在
- **WHEN** `uploads/images/` 目录不存在（首次启动 / Railway 部署）
- **THEN** `os.makedirs(save_dir, exist_ok=True)` 自动创建
- **AND** 上传正常完成

### Requirement: 场景分析路径解析
`scenario.py` SHALL 接收 `image_path`（可能是绝对路径、相对路径 `uploads/images/xxx.jpg`），统一解析为可读的绝对路径后传递给 `analyze_scenario`。

#### Scenario: 上传后分析
- **WHEN** 前端上传图片后调用 `/api/scenario/analyze`，`image_path` 为 `uploads/images/xxx.jpg`
- **THEN** 后端将相对路径解析为绝对路径（基于项目根目录或 uploads 挂载目录）
- **AND** 成功读取文件 → 调用 VLM 分析 → 返回场景要素和交际任务

#### Scenario: 文件不存在降级
- **WHEN** 图片路径解析后文件不存在
- **THEN** 降级为 Mock 数据
- **AND** 返回 HTTP 200（非 500）

## ADDED Requirements

### Requirement: 纯本地上传页面
`/scenario` 页面 SHALL 仅包含本地上传区域（拖拽/点击），不再显示样例照片库 Tab 或网格。

#### Scenario: 进入场景选择页
- **WHEN** 用户访问 `/scenario`
- **THEN** 页面仅显示上传区域（拖拽/点击选择图片）
- **AND** 不显示"样例照片库"/"本地上传"Tab 切换
- **AND** 不显示样例照片网格
