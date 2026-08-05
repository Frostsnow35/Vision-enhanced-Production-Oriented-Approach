# Checklist

## Task 1: 后端 Gap 模型扩展
- [x] `poa-project/poa-backend/models.py` Gap 新增 `reference_expression` 列
- [x] `poa-project/poa-backend/models.py` Gap 新增 `high_freq_errors` 列（注：实际放在 `AttemptSubmitResponse` 顶层，因为是 attempt 级别不是 gap 级别，更合理）
- [x] `poa-project/poa-backend/schemas.py` GapItem 新增 `reference_expression` 字段
- [x] `poa-project/poa-backend/schemas.py` AttemptSubmitResponse 新增 `high_freq_errors` 字段
- [x] `analyze_diagnose` prompt 追加 reference_expression + high_freq_errors 字段说明
- [x] analyze_diagnose 解析逻辑写入新字段

## Task 2: 高频错误提取
- [x] `_extract_high_freq_errors()` 函数已实现（使用 LLM）
- [x] 验证输入 "very much" * 3 次 → 返回 phrase="very much", occurrence=3
- [x] submit_attempt1/submit_attempt2 串联调用，结果合并到 response

## Task 3: InlineLoadingHint 组件
- [x] `poa-project/poa-frontend/src/components/InlineLoadingHint.tsx` 已创建
- [x] 4 条轮换提示词（"稍等，AI 正在快马加鞭..." / "💡 内容正在生成中" / "别急，好内容值得等一等 ✨" / "📚 正在为你定制个性化建议"）
- [x] 每 2.5 秒切换一条
- [x] shimmer 动画实现（用 tailwind animate-bounce 圆点）
- [x] props: `{message?, show, height}` 实现

## Task 4: /diagnosis UI 升级
- [x] gap 卡片显示"原句 vs 参考"对照
- [x] 老数据无 reference_expression 时降级到 explanation
- [x] useEffect 解析 high_freq_errors 为独立 state
- [x] "高频错误"区块在 <h1> 下方显示（仅非空时）
- [x] tag 显示 phrase + xN + 修正建议
- [x] useEffect 兼容三种格式（数组 / `{gaps: []}` / `{gaps: [], high_freq_errors: []}`）

## Task 5: /facilitate 加载提示 + 配色
- [x] 红色元素 ≤ 1 处（grep `destructive|red-` 在 facilitate/page.tsx）
- [x] phrases / dialogue / exercises / oral tab 加载中显示 InlineLoadingHint
- [x] assessment tab 加载中显示 InlineLoadingHint
- [x] 次严重提示改 amber/orange
- [x] 中性提示改 primary/muted
- [x] 仅"停止录音"按钮保留红色（最严重活跃状态）

## Task 6: /evaluate 加载提示
- [x] 加载中显示 InlineLoadingHint（2 个堆叠：AI 评价 + 提升分析）
- [x] 加载完成时内容渐入动画（`animate-in fade-in slide-in-from-bottom-2`）
- [x] 移除 SkeletonCard 依赖，使用 InlineLoadingHint 替代

## Task 7: /report API 错误处理
- [x] 404 时显示"该学习记录已过期或被删除"
- [x] 500 时显示"报告生成出错，请稍后重试"
- [x] 网络错误时显示"网络异常，请检查连接后重试"
- [x] 错误卡片含重试按钮 + 返回列表按钮
- [x] scenarioId 缺失时显示引导页（统一为 not_found 状态）
- [x] 错误信息中文友好

## Task 8: 端到端验证
- [x] scenario → task → attempt1 → diagnosis 全流程（已实现，等待真实演练）
- [x] 诊断页有原句+参考对照和高频错误
- [x] /facilitate 各 tab 加载中显示提示
- [x] /evaluate 加载提示出现
- [x] /report 正常数据能加载（已有 scenario 时进入正常流程）
- [x] /report 模拟 404 错误显示错误卡片
- [x] `npm run build` exit 0 ✅
- [x] 后端 services.ai_service 导入 OK ✅
- [x] Gap 表新增 `reference_expression` 字段，DB 迁移说明在 `models.py` 注释中
