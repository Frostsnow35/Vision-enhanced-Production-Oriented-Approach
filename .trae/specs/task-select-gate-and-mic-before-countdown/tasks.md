# Tasks

- [x] Task 1: 创建任务选择拦截组件 (TaskGate)
  - [x] 新建 `components/TaskGate.tsx`：检查 localStorage currentTask + session 标记，有任务渲染 children，无任务渲染 HistoryTaskSelector
  - **涉及文件**: `poa-frontend/src/components/TaskGate.tsx` (新建)

- [x] Task 2: 在所有任务关联页面包裹 TaskGate
  - [x] `app/attempt1/page.tsx` — 添加 import + 包裹根 JSX
  - [x] `app/attempt2/page.tsx` — 添加 import + 包裹根 JSX
  - [x] `app/diagnosis/page.tsx` — 添加 import + 包裹根 JSX
  - [x] `app/evaluate/page.tsx` — 添加 import + 包裹根 JSX
  - [x] `app/facilitate/page.tsx` — 添加 import + 包裹根 JSX
  - [x] `app/report/page.tsx` — 添加 import + 包裹根 JSX
  - **涉及文件**: 上述 6 个页面

- [x] Task 3: 修改 attempt1/attempt2 启动流程：等麦克风就绪再倒计时
  - [x] 新增 `micReadyWait` state，设备检测通过后 setMicReadyWait(true) 而非直接 setCountdownKey
  - [x] 新增 useEffect 监听 micStatus，ready/error 时启动倒计时，5 秒超时降级
  - **涉及文件**: `poa-frontend/src/app/attempt1/page.tsx`, `poa-frontend/src/app/attempt2/page.tsx`

# Task Dependencies
- Task 2 依赖 Task 1（需要 TaskGate 组件）
- Task 3 独立，已并行执行
