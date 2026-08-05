# Tasks

- [x] Task 1: 修复 `api.ts` — 使用相对路径替代绝对 URL
  - 文件: `e:\V-POA\poa-frontend\src\lib\api.ts`
  - 删除 `const BASE_URL = ...` 这一行
  - 将 `fetch(\`${BASE_URL}${path}\`)` 改为 `fetch(path)` 
  - 即所有请求使用相对路径 `/api/...`，由 Next.js rewrite 代理

- [x] Task 2: 修复 `config.py` — 修正豆包 Vision 模型 ID
  - 文件: `e:\V-POA\poa-backend\config.py`
  - 将 `ARK_MODEL_ID = "doubao-1.5-vision-pro-32k"` 改为 `ARK_MODEL_ID = "doubao-1.5-vision-pro-250328"`

- [x] Task 3: 修复 `next.config.ts` — BACKEND_URL 使用服务端环境变量
  - 文件: `e:\V-POA\poa-frontend\next.config.ts`
  - 将 `process.env.NEXT_PUBLIC_API_BASE` 改为 `process.env.BACKEND_URL`
  - 默认值保持 `"http://localhost:8000"`

- [x] Task 4: 新增 `poa-backend/railway.toml` — Railway 部署配置
  - 文件: `e:\V-POA\poa-backend\railway.toml`
  - 配置 build command: `pip install -r requirements.txt`
  - 配置 start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
  - 配置 Python 版本和监听端口

# Task Dependencies
- Task 1、2、3、4 相互独立，可并行执行