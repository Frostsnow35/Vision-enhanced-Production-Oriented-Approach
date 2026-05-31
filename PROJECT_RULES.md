# POA英语实景交际学习网站 - 项目规则

## 1. 项目概述

本项目是一个面向大学生的英语实景交际自驱式学习网站，遵循"实景情境—产出尝试—输入促成—双轨评价—产出验证"四步教学闭环。

**技术栈：**
- 前端：Next.js + TailwindCSS + shadcn/ui + React Query + ECharts
- 后端：FastAPI + SQLite/PostgreSQL + Celery + Redis
- AI：VLM（GPT-4V/MiniCPM-V）、LLM（GPT-3.5/4o-mini）、ASR（Whisper API）

---

## 2. 代码规范

### 2.1 前端规范（Next.js/TypeScript）

**命名规则：**
- 文件：kebab-case（如 `attempt1-page.tsx`）
- 组件：PascalCase（如 `ScenarioCard.tsx`）
- 变量/函数：camelCase（如 `generateTask`）
- 常量：UPPER_CASE_SNAKE_CASE（如 `MAX_RETRY_COUNT`）

**代码风格：**
- 使用 TypeScript 严格模式
- 函数参数和返回值必须标注类型
- 使用 `const` 优先于 `let`
- 组件拆分原则：单一职责，可复用性

**目录结构：**
```
frontend/
├── app/           # 页面路由（App Router）
├── components/    # 可复用组件
├── lib/           # 工具函数、hooks
├── data/          # 类型定义、mock数据
└── styles/        # 全局样式
```

### 2.2 后端规范（FastAPI/Python）

**命名规则：**
- 文件：snake_case（如 `poa_task_service.py`）
- 类：PascalCase（如 `VlmService`）
- 函数/变量：snake_case（如 `generate_poa_task`）
- 常量：UPPER_CASE_SNAKE_CASE

**代码风格：**
- 使用 Pydantic 进行数据校验
- 函数必须有类型提示
- 异常处理：使用自定义异常类
- 日志：关键操作必须记录日志

**目录结构：**
```
backend/
├── app/           # FastAPI应用
│   ├── api/       # 路由定义
│   ├── services/  # 业务逻辑
│   ├── models/    # 数据库模型
│   ├── schemas/   # Pydantic Schema
│   └── utils/     # 工具函数
└── tests/         # 测试用例
```

### 2.3 通用规范

- **注释：** 只对复杂逻辑写注释，代码本身应自解释
- **格式化：** 使用 Prettier（前端）/ Black（后端）自动格式化
- **Lint：** ESLint（前端）/ Ruff（后端）必须通过
- **依赖：** 保持依赖最新，定期更新

---

## 3. Git 分支策略

### 3.1 分支类型

| 分支类型 | 命名格式 | 用途 |
|---------|---------|------|
| 主分支 | `main` | 生产环境代码 |
| 开发分支 | `develop` | 集成开发分支 |
| 功能分支 | `feature/xxx` | 新功能开发 |
| Bug修复分支 | `bugfix/xxx` | 线上Bug修复 |
| 热修复分支 | `hotfix/xxx` | 紧急线上修复 |

### 3.2 分支流程

```
main ←── develop ←── feature/bugfix/hotfix
```

**流程说明：**
1. 从 `develop` 分支拉取功能分支
2. 开发完成后提交 PR 到 `develop`
3. PR 审核通过后合并到 `develop`
4. 发布前从 `develop` 合并到 `main`

---

## 4. 提交信息规范

### 4.1 格式

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### 4.2 类型说明

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug修复 |
| `docs` | 文档更新 |
| `style` | 代码格式调整（不影响功能） |
| `refactor` | 代码重构 |
| `test` | 测试相关 |
| `chore` | 构建/工具/依赖更新 |

### 4.3 示例

```
feat(scenario): 实现照片上传功能
fix(evaluation): 修复雷达图数据显示错误
docs(readme): 更新部署说明
```

---

## 5. PR 流程

### 5.1 PR 创建要求

1. **标题清晰：** 明确描述修改内容
2. **描述完整：** 说明修改原因、改动内容、测试方式
3. **关联Issue：** 如果有相关Issue，必须引用
4. **检查清单：**
   - [ ] 代码已通过 Lint 检查
   - [ ] 新增/修改测试用例
   - [ ] 文档已更新（如需）
   - [ ] 已进行本地测试

### 5.2 PR 审核

1. **自动检查：** CI/CD 自动运行测试和 Lint
2. **人工审核：** 至少需要1位开发者审核通过
3. **审核要点：**
   - 代码正确性和安全性
   - 代码风格和可读性
   - 是否符合项目架构
   - 测试覆盖率

### 5.3 合并规则

- 必须所有检查通过
- 必须至少1位审核者批准
- 使用 "Squash and Merge" 合并，保持提交历史清晰

---

## 6. 测试规范

### 6.1 测试覆盖

- **单元测试：** 核心业务逻辑必须覆盖
- **集成测试：** API 接口必须测试
- **E2E测试：** 关键用户流程必须覆盖

### 6.2 测试框架

- 前端：Jest + React Testing Library
- 后端：pytest
- E2E：Playwright

### 6.3 测试执行

```bash
# 前端测试
cd frontend && npm test

# 后端测试
cd backend && pytest

# E2E测试
npm run test:e2e
```

---

## 7. 部署规范

### 7.1 环境配置

| 环境 | 部署位置 | 配置来源 |
|------|---------|---------|
| 开发 | 本地 | `.env.local` |
| 测试 | 预览环境 | 环境变量 |
| 生产 | Vercel/Railway | 环境变量 |

### 7.2 部署流程

**前端（Vercel）：**
1. 合并到 `main` 分支自动触发部署
2. 部署前自动运行构建和测试

**后端（Railway）：**
1. 合并到 `main` 分支自动触发部署
2. 环境变量通过 Railway 控制台配置

### 7.3 环境变量管理

- 敏感信息必须使用环境变量
- 不得在代码中硬编码密钥
- `.env` 文件必须加入 `.gitignore`

---

## 8. 错误处理规范

### 8.1 前端错误处理

- 使用 try-catch 包裹异步操作
- 全局错误边界捕获未处理异常
- 友好的错误提示，避免暴露技术细节

### 8.2 后端错误处理

- 使用自定义异常类
- 统一异常处理中间件
- 返回标准化错误响应格式

```json
{
  "error": "string",
  "detail": "string",
  "code": "integer"
}
```

---

## 9. 性能规范

### 9.1 前端性能

- 图片懒加载
- 组件按需加载（Suspense）
- API 请求缓存（React Query）
- 避免不必要的重渲染

### 9.2 后端性能

- 数据库查询优化（索引）
- 异步任务队列（Celery）
- 结果缓存（Redis）
- 合理的超时设置

---

## 10. 安全规范

- 输入数据校验（前端+后端双重校验）
- 防止 XSS/CSRF 攻击
- API 限流
- HTTPS 强制启用
- 用户数据加密存储

---

## 附录：项目关键数据对象

```typescript
interface Scenario {
  id: string;
  photo_url: string;
  tags: string[];
}

interface POATask {
  id: string;
  scenario_id: string;
  your_role: string;
  ai_role: string;
  goal: string;
  constraints: string[];
  evaluation_criteria: string[];
}

interface Attempt {
  id: string;
  task_id: string;
  attempt_number: number;
  audio_url: string;
  transcript: string;
  turns: Turn[];
}

interface Gap {
  id: string;
  type: string;
  evidence: string;
  consequence: string;
  target_improvement: string;
}

interface Evaluation {
  id: string;
  attempt1_id: string;
  attempt2_id: string;
  seven_dimension_scores: number[];
  gap_improvements: GapImprovement[];
  overall_judgment: string;
}
```