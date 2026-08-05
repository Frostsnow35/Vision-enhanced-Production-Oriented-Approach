# Tasks

- [x] Task 1: 后端 Gap 模型扩展 + Schema + AI prompt
  - [x] SubTask 1.1: 在 `poa-project/poa-backend/models.py` 的 `Gap` 类中新增 `reference_expression: Column(Text, nullable=True)` 和 `high_freq_errors: Column(JSON, nullable=True)` 列
  - [x] SubTask 1.2: 在 `poa-project/poa-backend/schemas.py` 的 `GapItem` / `GapResponse` 中新增对应字段
  - [x] SubTask 1.3: 在 `poa-project/poa-backend/services/ai_service.py` 的 `analyze_diagnose` prompt 中追加 `reference_expression` + `high_freq_errors` 字段说明
  - [x] SubTask 1.4: 修改 `analyze_diagnose()` 解析后，把 high_freq_errors 写入每个 gap 的对应字段

- [x] Task 2: 后端高频错误提取函数 + submit_attempt1 串联
  - [x] SubTask 1.1: 在 `ai_service.py` 中新增 `_extract_high_freq_errors(attempt_text, gaps) -> List[{phrase, occurrence, suggestion}]`，使用 LLM 单次调用，从 attempt_text 中识别 phrase-level 错误
  - [x] SubTask 1.2: 在 `routers/attempt.py` 的 `submit_attempt1` 路由中：诊断后调用 `_extract_high_freq_errors`，结果合并到 `AttemptSubmitResponse.gaps` 的顶层或新增字段
  - [x] SubTask 1.3: 验证：手工测试输入一段含 3 次 "very much"（应为 "really"）的文本，提取函数返回 `[{phrase: "very much", occurrence: 3, suggestion: "改用 really"}]`

- [x] Task 3: 前端 InlineLoadingHint 组件
  - [x] SubTask 3.1: 新建 `poa-project/poa-frontend/src/components/InlineLoadingHint.tsx`
  - [x] SubTask 3.2: 实现 4 条轮换提示词（"稍等，AI 正在快马加鞭整理你的内容..." / "💡 内容正在生成中" / "别急，好内容值得等一等 ✨" / "📚 正在为你定制个性化建议"），每 2.5 秒切换
  - [x] SubTask 3.3: 实现 shimmer 动画（用 tailwind animate-pulse + bg-gradient）
  - [x] SubTask 3.4: 实现 props：`{message?: string, show?: boolean, height?: string}`，`show=false` 时返回 null

- [x] Task 4: /diagnosis 报告 UI 升级
  - [x] SubTask 4.1: 在 diagnosis/page.tsx 第 130-184 行 gap 卡片内增加"原句 vs 参考表达"对照：原句在左（`bg-muted/30 italic`），参考在右（`bg-primary/5 text-primary border-l-2 border-l-primary`）
  - [x] SubTask 4.2: 兼容老数据：无 `reference_expression` 时降级显示 `gap.explanation`
  - [x] SubTask 4.3: 在 useEffect 解析时增加 `high_freq_errors` 读取，存储为独立 state
  - [x] SubTask 4.4: 在 <h1> 下方增加"高频错误"区块：仅当数组非空时显示；含 1-3 个 tag（`bg-amber-100 text-amber-800 rounded-full`），每个 tag 显示 `phrase + xN` + 修正建议
  - [x] SubTask 4.5: 修改 useEffect 兼容三种格式（数组 / `{gaps: []}` / `{gaps: [], high_freq_errors: []}`）

- [x] Task 5: /facilitate 加载提示 + 配色整改
  - [x] SubTask 5.1: 在 facilitate/page.tsx 找到所有使用 `destructive` / `text-red-*` / `bg-red-*` 的地方
  - [x] SubTask 5.2: 严重警告保留红（≤ 1 处——仅保留录音进行中的"停止录音"按钮），其他改 amber/orange/primary/muted
  - [x] SubTask 5.3: 在每个 tab 加载中（phrases / dialogue / exercises / oral）插入 `<InlineLoadingHint />` 组件
  - [x] SubTask 5.4: 在 assessment tab 加载中也插入 InlineLoadingHint
  - [x] SubTask 5.5: 验证：grep `destructive` 和 `text-red` 在 facilitate/page.tsx 中 ≤ 1 处

- [x] Task 6: /evaluate 加载提示
  - [x] SubTask 6.1: 在 evaluate/page.tsx 各 section（雷达图/条形图/分数详情/靶向评估）加载中插入 `<InlineLoadingHint />`
  - [x] SubTask 6.2: 加载完成时内容渐入（`animate-in fade-in slide-in-from-bottom-2`）

- [x] Task 7: /report API 错误处理修复
  - [x] SubTask 7.1: 在 report/[id]/page.tsx 增加 `reportError: string | null` state
  - [x] SubTask 7.2: 把 `if (res.ok) { setReport(...) }` 改为：try/catch 分别处理 404（"该学习记录已过期或被删除"）/ 500（"报告生成出错"）/ 网络错误（"网络异常"）
  - [x] SubTask 7.3: 渲染错误卡片（含重试按钮和返回列表按钮）
  - [x] SubTask 7.4: scenarioId 缺失时显示引导页（"未找到该学习记录" + 返回列表）

- [x] Task 8: 端到端验证 + 构建
  - [x] SubTask 8.1: 走完 scenario → task → attempt1 → diagnosis 完整流程，确认新诊断页有原句+参考对照和高频错误
  - [x] SubTask 8.2: 走 /facilitate 各 tab，确认加载中有 InlineLoadingHint 轮换
  - [x] SubTask 8.3: 走 /evaluate，确认加载提示出现
  - [x] SubTask 8.4: 走 /report，确认正常数据能加载；同时模拟 404 错误，确认错误卡片出现
  - [x] SubTask 8.5: 跑 `npm run build`，无 TypeScript 错误

# Task Dependencies
- Task 1 独立
- Task 2 依赖 Task 1
- Task 3 独立
- Task 4 依赖 Task 1, 2
- Task 5 依赖 Task 3
- Task 6 依赖 Task 3
- Task 7 独立
- Task 8 依赖 Task 1-7
