# Tasks

- [x] Task 1: 修复后端上传和场景分析 500 错误
  - [x] Task 1.1: 在 `scenario.py` 中将上传返回的相对路径 `uploads/images/xxx.jpg` 解析为基于项目根目录的绝对路径
  - [x] Task 1.2: 在 `upload.py` 中强化目录存在性保证（已在 `os.makedirs`，确认无遗漏）

- [x] Task 2: 移除前端样例照片库，简化为纯本地上传页
  - [x] Task 2.1: 移除 `SAMPLE_PHOTOS` 常量、`SampleGrid` 组件、`SceneIcon` 组件、Tab 切换 UI
  - [x] Task 2.2: 简化页面状态逻辑（移除 `tab`、`selectedSample` 等不再需要的状态）
  - [x] Task 2.3: 保留并优化 `UploadZone` 组件和 `handleGenerate` 上传+分析流程

- [x] Task 3: 清理不再需要的 /samples 静态服务
  - [x] Task 3.1: 移除 `main.py` 中 `/samples` 静态文件挂载和 `sample_images/` 目录创建
  - [x] Task 3.2: 移除 `next.config.ts` 中 `/samples/:path*` rewrite 规则

# Task Dependencies
- Task 2 依赖 Task 1（需要后端路径解析先行修复，确保端到端可用）
- Task 3 独立于 Task 1/2，可并行
