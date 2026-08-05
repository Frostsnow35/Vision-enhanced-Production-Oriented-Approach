# Tasks

- [x] Task 1: 修复诊断文本格式 — `attempt1/page.tsx` 提交诊断时不拼接中文标签
  - [x] SubTask 1.1: 将 `[用户]: ... \n [AI]: ...` 格式改为纯对话原文行 `\n` 拼接
  - [x] SubTask 1.2: 验证 `attempt2/page.tsx` 是否有同样问题，一并修复（attempt2 使用结构化 JSON 发送，无此问题）

- [x] Task 2: 防重复点击 — `scenario/page.tsx` 按钮禁用逻辑
  - [x] SubTask 2.1: 在 `handleGenerate` 开头检查 `submitting` 状态，若已提交则直接 return
  - [x] SubTask 2.2: 确认 Button 的 `disabled` 属性正确绑定 `!uploadedFile || submitting`

- [x] Task 3: attempt_number 动态推断 — `facilitate/page.tsx`
  - [x] SubTask 3.1: 检查 `localStorage.getItem("diagnosis2")` 判断当前是第1轮还是第2轮
  - [x] SubTask 3.2: 将 `attempt_number` 从硬编码 `1` 改为动态值

- [x] Task 4: 重新分析按钮 — `scenario/page.tsx` 历史场景卡片
  - [x] SubTask 4.1: 每个历史场景卡片添加"重新分析"按钮（🔄 刷新图标）
  - [x] SubTask 4.2: 点击后调用 `/api/scenario/analyze`，用新结果替换旧历史条目
  - [x] SubTask 4.3: 清除相关 localStorage 缓存（与新建场景逻辑一致）

- [x] Task 5: 低风险 TypeScript 错误修复
  - [x] SubTask 5.1: `task/page.tsx:L7` — `ScenarioHistoryItem` 改为从 `@/lib/store` 导入
  - [x] SubTask 5.2: `facilitate/page.tsx:L8` — 同上，修复 import 路径
  - [x] SubTask 5.3: `facilitate/page.tsx:L681` — 修复冗余比较，直接删除 `&& progress.tabs[t] !== "completed"`
  - [x] SubTask 5.4: `diagnosis/page.tsx:L95-L131` — 在使用 `gaps` 前添加非 null 检查
  - [x] SubTask 5.5: `report/[id]/page.tsx:L574-L634` — 对 `report?.xxx` 添加 `?? null` 处理
  - [x] SubTask 5.6: `attempt1/page.tsx:L321` — `onSelected` 中将 `ScenarioHistoryItem` 转为 `TaskData` 兼容对象
  - [x] SubTask 5.7: `attempt2/page.tsx:L506-L507` — 同上
  - [x] SubTask 5.8: `attempt1/page.tsx:L233` — 给 `onerror` 回调参数添加 `: Event` 类型

- [x] 额外修复: facilitate/page.tsx 中 `item.scene_label` → `item.sceneLabel` (camelCase)
  - ScenarioHistoryItem 类型正确定义为 `sceneLabel`（驼峰），两处使用修复为一致

# Task Dependencies
- Task 1~5 相互独立，可并行执行
- 所有 Task 完成后统一运行 TypeScript 类型检查验证 ✅
