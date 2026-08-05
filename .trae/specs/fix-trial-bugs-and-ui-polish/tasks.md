# Tasks

- [x] Task 1: 删除任务页变体挑战（task/page.tsx）
  - [x] SubTask 1.1: 删除第 194-204 行的 `{/* 变体挑战 */}` JSX 区块
  - [x] SubTask 1.2: 删除第 230-245 行的 `{task.variant_plot && (...)}` 按钮区块
  - [x] SubTask 1.3: 验证：grep `variant_plot` 在 task/page.tsx 中为 0 处

- [x] Task 2: 场景分析趣味 loading modal（scenario/page.tsx）
  - [x] SubTask 2.1: 在 `submitting=true` 时渲染全屏遮罩：`<div className="fixed inset-0 z-50 backdrop-blur-md bg-background/80 flex items-center justify-center">`
  - [x] SubTask 2.2: 在遮罩内渲染居中卡片：图标 + 标题 + 6-8 条轮换提示词 + 3 个跳动圆点
  - [x] SubTask 2.3: 提示词数组常量：`const FUN_TIPS = ["AI 正在仔细观察照片...", "别急，好的任务需要细细打磨 ✨", ...]`
  - [x] SubTask 2.4: 用 `useState` + `useEffect setInterval` 每 3 秒切换一条
  - [x] SubTask 2.5: 验证：dev server 测试，submitting=true 时 modal 立即出现

- [x] Task 3: 倒计时配色（CountdownEffect.tsx）
  - [x] SubTask 3.1: 把 `bg-primary/10`、`bg-primary/20`、`bg-primary/30` 三层光晕大小从 64/48/32 改为 48/36/24
  - [x] SubTask 3.2: 把 `drop-shadow-[0_0_30px_rgba(59,130,246,0.8)]` 中的硬编码颜色改为 `text-primary`（Tailwind 会自动读取 `--primary`）
  - [x] SubTask 3.3: 把内联 `textShadow` 改为不写硬编码色，或保留 alpha 但统一用 primary 色调
  - [x] SubTask 3.4: 验证：dev server 触发倒计时，视觉上不再刺眼且颜色与网站一致

- [x] Task 4: VLM 输出清洗（ai_service.py）
  - [x] SubTask 4.1: 新增函数 `_sanitize_opening_line(raw: str) -> str`：检测 `^\d+(-\d+)+$` 模式 → 返回 `""`；长度 > 25 词 → 截断；与 closing_line 相同 → 返回 `""`
  - [x] SubTask 4.2: 在 `_SCENE_PROMPT` 第 7 条（opening_line）追加约束：禁止数字串 / 连续 dash / JSON 残留 / 禁止编造具体菜单产品
  - [x] SubTask 4.3: 在 `analyze_scenario()` 解析后调用 `_sanitize_opening_line(result["opening_line"])`
  - [x] SubTask 4.4: 验证：手工 mock `opening_line = "12-3-45-67"` 调用 analyze_scenario，返回值中 `opening_line == ""`（已验证："12-3-45-67" → ''，"Hi! What can I get for you today?" → 保留，"vanilla lattes, cappuccinos, cold brew" → ''）

- [x] Task 5: 诊断页 useEffect 数据格式修复
  - [x] SubTask 5.1: 在 `diagnosis/page.tsx` 第 38-40 行的 useEffect 中，把 `setGaps(JSON.parse(raw))` 改为兼容数组和 `{gaps: []}` 两种格式
  - [x] SubTask 5.2: 验证：dev server 走 attempt1 → submit → 跳转诊断页，无 `gaps?.map is not a function` 报错

- [x] Task 6: 端到端验证 + 构建
  - [x] SubTask 6.1: 走完 scenario → task → attempt1 → diagnosis 完整流程
  - [x] SubTask 6.2: 确认任务页无变体挑战
  - [x] SubTask 6.3: 确认 scenario 分析中 modal 出现 + 提示词轮换
  - [x] SubTask 6.4: 确认 attempt1 录音时倒计时配色不刺眼
  - [x] SubTask 6.5: 跑 `npm run build`，无 TypeScript 错误（exit code 0，13/13 路由）

# Task Dependencies
- Task 1 独立
- Task 2 独立
- Task 3 独立
- Task 4 独立
- Task 5 独立
- Task 6 依赖 Task 1-5
