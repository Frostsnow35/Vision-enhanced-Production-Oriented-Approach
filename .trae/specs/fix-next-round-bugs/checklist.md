# Checklist

- [x] A: `attempt1/page.tsx` 提交诊断时 `attempt_text` 不包含 `[用户]:`/`[AI]:` 中文标签
- [x] B: `scenario/page.tsx` "生成交际任务"按钮在 `submitting=true` 时不可重复触发
- [x] C: `facilitate/page.tsx` `/api/facilitate/generate` 请求中 `attempt_number` 根据上下文动态设置，非硬编码 1
- [x] D: `scenario/page.tsx` 历史场景卡片显示"重新分析"按钮，点击后重新调用 analyze API 并替换历史条目
- [x] E: `task/page.tsx` 从 `@/lib/store` 导入 `ScenarioHistoryItem`（非 HistoryTaskSelector）
- [x] F: `facilitate/page.tsx` 从 `@/lib/store` 导入 `ScenarioHistoryItem`（非 HistoryTaskSelector）
- [x] G: `facilitate/page.tsx:L681` 冗余 `"visited" !== "completed"` 比较已移除
- [x] H: `diagnosis/page.tsx` 所有 `gaps` 使用前已检查非 null
- [x] I: `report/[id]/page.tsx` 所有 `report?.xxx` 传参已用 `?? null` 处理
- [x] J: `attempt1/page.tsx` HistoryTaskSelector `onSelected` 回调用 `ScenarioHistoryItem` 字段创建 `TaskData` 兼容对象
- [x] K: `attempt2/page.tsx` 同上
- [x] L: `attempt1/page.tsx:L233` `onerror` 回调参数添加 `: Event` 类型注解
- [x] M: `npx tsc --noEmit` 不报任何**新增**错误（高风险 SpeechRecognition 和 setProgress 除外）
- [x] N: facilitate/page.tsx 中 `item.scene_label` (snake_case) → `item.sceneLabel` (camelCase) 修复（额外发现）
