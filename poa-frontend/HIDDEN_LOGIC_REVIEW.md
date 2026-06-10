# Day9 隐藏逻辑审查报告

> 范围：`facilitate/page.tsx`、`diagnosis/page.tsx`、`evaluate/page.tsx`
> 审查日期：2026-06-08

## 审查方法
- 搜索三页中所有 `if (!x) return` / `return null` / 早退分支
- 重点关注"组件被调用但隐藏的提示/未覆盖的边界"

---

## 已发现并修复的 Bug

### 🐛 Bug #1: facilitate 无历史时卡死
**位置**：[facilitate/page.tsx](file:///e:/V-POA/poa-project/poa-frontend/src/app/facilitate/page.tsx) - `!hasTask` 分支
**症状**：用户首次进入促成学习页（没有任何历史任务）→ 渲染 `HistoryTaskSelector` → 但因为没有历史，组件只显示空状态，用户无法继续
**修复**：传 `autoRedirectIfEmpty reloadOnSelect`，组件会在空时自动跳转到场景驱动

### 🐛 Bug #2: diagnosis 有历史时卡死（无 props）
**位置**：[diagnosis/page.tsx](file:///e:/V-POA/poa-project/poa-frontend/src/app/diagnosis/page.tsx) - `hasHistory` 分支
**症状**：有历史时显示 `HistoryTaskSelector`；无历史时无法跳转
**修复**：传 `autoRedirectIfEmpty reloadOnSelect`

### 🐛 Bug #3: evaluate 有历史时卡死
**位置**：[evaluate/page.tsx](file:///e:/V-POA/poa-project/poa-frontend/src/app/evaluate/page.tsx) - `hasHistory` 分支
**症状**：同上
**修复**：传 `autoRedirectIfEmpty reloadOnSelect`

---

## 潜在风险（未修复，需后续）

### ⚠️ Risk #1: `!gaps || gaps.length === 0` 隐藏功能
diagnosis 页 `gaps.length === 0` 分支会显示"未发现明显不足"卡片，但**不会给用户明确的"去做评价"指引**。可能造成"我以为做完了但没保存"。

### ⚠️ Risk #2: evaluate 的 `!data || dims.length === 0` 分支
"暂无评价数据" 卡片有"返回场景驱动"按钮，OK。但若用户没完成 attempt2 直接来 evaluate，会看到该提示。

### ⚠️ Risk #3: facilitate 的 6 个 useEffect 早退
387/404/442 行 `if (!hasTask || !initDone) return` 是合理的（未就绪时跳过副作用）。无 bug。

---

## 状态

- ✅ 已修复 3 个卡死 bug
- ⚠️ 记录 3 个潜在风险，建议下一轮优化
