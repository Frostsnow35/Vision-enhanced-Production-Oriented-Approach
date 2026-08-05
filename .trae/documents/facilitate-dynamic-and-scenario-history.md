# POA 促成学习动态化 + 历史场景管理 — 实施计划

## 需求摘要

1. **促成学习去 Mock 化**：词块/示范对话/练习从硬编码咖啡店 → 后端 LLM 根据诊断 Gap 动态生成
2. **场景历史管理**：刷新后回到场景页，用户从历史场景列表中选择要继续的任务

***

## Part 1: 促成学习后端动态生成

### 1.1 新增后端 API `POST /api/facilitate/generate`

**文件**: `poa-backend/routers/facilitate.py` (新建)

**输入**:

```json
{
  "gaps": [
    {"label": "语用策略得体性", "evidence_sentence": "...", "explanation": "..."},
    {"label": "词汇适配性", "evidence_sentence": "...", "explanation": "..."}
  ],
  "scene_label": "Coffee Shop",
  "roles": "A: Customer; B: Barista",
  "goal": "购买一杯中杯冰拿铁",
  "attempt_number": 1
}
```

**输出**:

```json
{
  "phrases": [
    {"function": "礼貌请求", "sentence": "I'd like a large latte, please."},
    ...
  ],
  "dialogue": {
    "title": "咖啡店点单 — 精准示范",
    "lines": [
      {"speaker": "Barista", "text": "..."},
      ...
    ]
  },
  "exercises": [
    {
      "id": 1,
      "context": "你在咖啡店想要一杯中杯冰拿铁...",
      "options": [{"key": "A", "text": "..."}, ...],
      "answer": "A",
      "explanation": "..."
    }
  ]
}
```

**降级**: LLM 调用失败 → 返回当前硬编码 Mock 数据作为兜底

### 1.2 新增 `services/facilitate_service.py`

**文件**: `poa-backend/services/facilitate_service.py` (新建)

* `generate_materials(gaps, scene_context) -> dict`

* System prompt: 根据诊断 Gap 和场景生成精准词块、示范对话、2\~3 道即时练习

* 使用豆包 LLM API（与现有 `ai_service.py` 一致的方式）

* 强制 JSON 输出，失败重试 1 次

### 1.3 注册路由

**文件**: `poa-backend/main.py`

* 添加 `from routers.facilitate import router as facilitate_router`

* 添加 `app.include_router(facilitate_router)`

### 1.4 前端 `facilitate/page.tsx` 改造

**文件**: `poa-frontend/src/app/facilitate/page.tsx`

* 页面加载时调用 `POST /api/facilitate/generate`

  * 从 `localStorage("diagnosis")` 取 gaps

  * 从 `localStorage("currentTask")` 取场景上下文

* 展示 loading 态

* API 失败时降级为当前 Mock

* 保留四个 Tab：能力评估 / 词块句式 / 示范对话 / 即时练习

***

## Part 2: 场景历史管理

### 2.1 数据模型

**localStorage 结构**:

```
"poa_scenarios" (新增):
[{
  "id": "uuid-v4",
  "createdAt": "2026-05-30T12:00:00Z",
  "sceneLabel": "Coffee Shop",
  "roles": "A: Customer; B: Barista",
  "goal": "点一杯中杯冰拿铁",
  "imageUrl": "/uploads/images/xxx.png",
  "task": { ... }  // 完整的 POA 任务数据
}]

"currentScenarioId" (新增): "uuid-v4"  // 当前激活的场景 ID
"currentTask" (已有): { ... }          // 当前激活任务的完整数据，由 activeScenarioId 推导
```

### 2.2 场景页 `scenario/page.tsx` 改造

**文件**: `poa-frontend/src/app/scenario/page.tsx`

**改造点**:

1. 页面加载时从 `poa_scenarios` 读取历史列表
2. 页面布局改为两段式：

   * **上部**: 上传区域（拖拽/点击上传新场景图片）

   * **下部**: 历史场景列表（卡片式，每张显示场景标签、时间、缩略图）
3. 上传新照片成功后 → 自动添加到 `poa_scenarios` 头部 → 设为 `currentScenarioId` → 跳转 `/task`
4. 点击历史卡片 → 设为 `currentScenarioId` → 加载对应 task 到 `currentTask` → 跳转 `/task`
5. 历史卡片右上角有删除按钮（X），点击确认后移除

### 2.3 各页面读取方式调整

**`task/page.tsx`**:

* 已有 `localStorage.getItem("currentTask")` 逻辑，无需改动

* 添加"返回场景"链接，允许用户换场景

**`attempt1/page.tsx`**:

* 已有 `localStorage.getItem("currentTask")` 逻辑，无需改动

**刷新行为**:

* 任意页面刷新 → React 状态丢失 → Next.js 的 `useEffect` 重新执行

* 如果 `currentTask` 存在于 localStorage → 数据仍在，页面可正常渲染

* 如果用户想换场景 → 点击导航栏的「场景驱动」回到 scenario 页 → 选择历史场景或上传新图

* 新增：顶部导航增加「返回场景」按钮/链接

### 2.4 Header/Nav 增加「场景」入口

**文件**: `poa-frontend/src/components/` 或 `layout.tsx`

* 全局 Header 中确保 `场景驱动` 链接指向 `/scenario`

* 可选：当前场景标签显示在 Header 中

***

## Part 3: 实施步骤

| 步骤 | 文件                                           | 说明                                 |
| -- | -------------------------------------------- | ---------------------------------- |
| 1  | `poa-backend/services/facilitate_service.py` | 新建：LLM 生成精准学习材料                    |
| 2  | `poa-backend/routers/facilitate.py`          | 新建：`POST /api/facilitate/generate` |
| 3  | `poa-backend/main.py`                        | 注册 facilitate 路由                   |
| 4  | `poa-frontend/src/app/facilitate/page.tsx`   | 改造：调用后端 API，loading/降级             |
| 5  | `poa-frontend/src/lib/store.ts`              | 新增 `poa_scenarios` 的读写工具函数         |
| 6  | `poa-frontend/src/app/scenario/page.tsx`     | 改造：历史场景列表 + 卡片选择 + 删除              |
| 7  | 前端编译验证                                       | 确保无编译错误                            |
| 8  | 后端重启验证                                       | 确保 API 可用，全链路测试                    |

***

## Part 4: 验收标准

* [ ] 上传场景照片 → 进入 task → 进入 attempt1 对话 → 提交诊断 → 促成学习页不再显示咖啡店 Mock 数据

* [ ] 促成学习页显示与诊断 Gap 匹配的精准词块、示范对话和练习

* [ ] LLM 失败时降级为 Mock，页面可继续使用

* [ ] 场景页显示历史场景列表（按时间倒序）

* [ ] 可点击历史场景进入任务页，数据完整

* [ ] 可删除不需要的历史场景

* [ ] 刷新后回到场景页，能正确选择历史场景继续

* [ ] 上传新场景后能立即看到并选择

