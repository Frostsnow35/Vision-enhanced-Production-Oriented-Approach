# 试用 Bug 修复 + UI 打磨 Spec

## Why
用户试用过程中发现 5 个问题：(1) 任务页出现了 `变体挑战` 区块（之前 polish-core-learning-loop Task 2 加的功能，但与当前 1 主目标 + ≤1 选子目标 规模约束冲突，且 attempt2 改用变体任务模式后这里已经多余）；(2) 场景分析等待时没有趣味提示框，用户心理等待时间长；(3) 录音倒计时特效颜色与网站主色不搭；(4) AI 开场白生成了"一串数字和'-'的组合"乱码（VLM 输出未做清洗）；(5) 提交诊断后诊断页崩溃，错误 `gaps?.map is not a function`（useEffect 把 `{gaps: []}` 对象整体赋值给 `gaps` 状态）。

## What Changes
- **删除** `task/page.tsx` 第 194-204 行 `变体挑战` 区块 + 第 230-245 行 `挑战变体情节` 按钮 + localStorage 的 `variantContext` 写入
- **新增** `scenario/page.tsx` 全屏遮罩 loading modal（含 6-8 条趣味提示词轮播 + 进度点）
- **修改** `components/CountdownEffect.tsx` 颜色：主色蓝 (#3B82F6) → 网站主色（读取 CSS 变量 `--primary`），同时降低光晕强度避免刺眼
- **新增** 后端 `services/ai_service.py` 的 `opening_line` 清洗：正则剔除数字串、连续 dash、长度异常（> 60 词）的值
- **修改** `services/ai_service.py` `_SCENE_PROMPT`：新增 `opening_line` 输出约束（"必须是一句不超过 25 词的英文开场白，禁止包含数字串、连续 dash、JSON 残留"）
- **修复** `diagnosis/page.tsx` useEffect：把 `data.gaps` 提取出来赋给 `gaps` 状态（兼容数组和 `{gaps: []}` 两种格式）

## Impact
- Affected specs: task-page, scenario-page, attempt1/2, ai-service, diagnosis-page
- Affected code:
  - `poa-project/poa-frontend/src/app/task/page.tsx` — **删除** 变体挑战区块 + 挑战变体情节按钮
  - `poa-project/poa-frontend/src/app/scenario/page.tsx` — **新增** LoadingModal 组件 / 调用
  - `poa-project/poa-frontend/src/components/CountdownEffect.tsx` — **修改** 颜色变量
  - `poa-project/poa-frontend/src/app/diagnosis/page.tsx` — **修复** useEffect 数据格式
  - `poa-project/poa-backend/services/ai_service.py` — **修改** _SCENE_PROMPT + 新增 opening_line 清洗函数

## ADDED Requirements

### Requirement: 任务页移除变体挑战
`task/page.tsx` SHALL **不再渲染** 变体挑战区块和挑战变体情节按钮。即使 `task.variant_plot` 字段存在，也 SHALL 完全不显示相关内容（VLM 生成的 `variant_plot` 仍持久化到 DB，attempt2 通过 `variantContext` localStorage 自行消费，与 task 页面解耦）。

#### Scenario: 任务页无变体挑战
- **WHEN** 用户访问 `/task` 页面
- **THEN** 任务卡 SHALL 仅显示 5 个区块：场景标签 / 角色设定 / 交际目标 / 语境提示 / 成功标准
- **AND** SHALL NOT 出现 `VARIANT` 角标
- **AND** SHALL NOT 出现 `挑战变体情节` 按钮
- **AND** "开始初次产出" 按钮 SHALL 居右独占

### Requirement: 场景分析趣味 loading modal
`scenario/page.tsx` 在 `submitting=true` 时 SHALL 显示全屏模糊遮罩（`backdrop-blur-md` + `bg-background/80`）和居中卡片，卡片内含：
- 旋转图标（已有 SVG spinner）
- 进度文案："正在识别场景并生成任务..."
- 6-8 条趣味提示词，每 3 秒轮换一条（用 `setInterval` + `useState`），如：
  - "AI 正在仔细观察照片里的每一个细节..."
  - "别急，好的任务需要细细打磨 ✨"
  - "咖啡师正在回忆常被问到的 10 个问题..."
  - "正在为这场对话挑选最贴合的词汇表 ☕"
  - "下一步会根据你的目标推荐对话策略 💡"
  - "完成分析后可直接进入录音环节 🎙"
- 底部三个跳动小圆点（已有动画）

#### Scenario: 模态正常显示
- **WHEN** 用户点击 "生成交际任务" 且 `submitting=true`
- **THEN** 全屏遮罩 SHALL 立即出现（不允许有 100ms+ 延迟）
- **AND** 模态卡片 SHALL 显示当前轮换的提示词
- **AND** 提示词每 3 秒切换一条
- **AND** 用户无法点击模态外区域

#### Scenario: 模态正常关闭
- **WHEN** 接口返回（成功或失败）
- **THEN** 模态 SHALL 立即消失
- **AND** 切换到 `submitting=false` 后恢复正常 UI

### Requirement: 倒计时特效配色与网站一致
`CountdownEffect.tsx` SHALL 使用网站主色（从 `globals.css` 的 `--primary` 变量读取，或使用 Tailwind 的 `text-primary` / `bg-primary` 工具类）替代当前的硬编码 `bg-primary/10` (淡蓝)。光晕 SHALL 适当降低（从 `size-64`/`size-48`/`size-32` 缩小到 `size-48`/`size-36`/`size-24`），drop-shadow 从 30px 降至 20px，避免刺眼。

#### Scenario: 配色统一
- **WHEN** 倒计时显示
- **THEN** 数字颜色 SHALL 与网站主色一致（与首页按钮、任务卡标签同色系）
- **AND** 光晕 SHALL 不刺眼
- **AND** 字体仍为 `text-6xl font-black`

### Requirement: VLM 输出清洗（防乱码）
后端 `services/ai_service.py` SHALL 在 `analyze_scenario()` 解析 VLM 输出后，对 `opening_line` 字段做清洗：
- 若匹配 `^\d+(-\d+)+$`（纯数字串 + dash 组合）→ 置空字符串 `""`
- 若长度 > 25 词 → 截断到 25 词
- 若与 `closing_line` 完全相同 → 置空（避免复用）
- 清洗后 `opening_line == ""` 时，调用方降级到 `chat/generate_opening` LLM 实时生成

#### Scenario: 检测到乱码并降级
- **WHEN** VLM 返回 `opening_line = "12-3-45-67"`
- **THEN** `analyze_scenario()` SHALL 把它置为 `""`
- **AND** 前端 `chatStart` SHALL 降级到 `generate_opening` LLM 调用
- **AND** 用户 SHALL 看到一段合理的场景化开场白

#### Scenario: 正常开场白通过
- **WHEN** VLM 返回 `opening_line = "Hi! What can I get for you today?"`
- **THEN** `analyze_scenario()` SHALL 保留原值
- **AND** 持久化到 DB
- **AND** `chatStart` 直接使用

### Requirement: 诊断页数据格式修复
`diagnosis/page.tsx` useEffect SHALL 兼容两种数据格式：
- 旧格式：`data` 是数组 `[gap1, gap2, ...]`
- 新格式：`data` 是 `{gaps: [gap1, gap2, ...]}` 对象

实现：`const gapList = Array.isArray(data) ? data : (data.gaps ?? []); setGaps(gapList);`

#### Scenario: 新格式（API 实际返回）
- **WHEN** `localStorage.diagnosis = '{"gaps": [{"label": "...", ...}, ...]}'`
- **THEN** `gaps` 状态 SHALL 被设置为 `[{"label": "...", ...}, ...]` 数组
- **AND** `gaps?.map(...)` SHALL 正常执行
- **AND** 不再抛 `gaps?.map is not a function`

#### Scenario: 旧格式（历史数据）
- **WHEN** `localStorage.diagnosis = '[{"label": "..."}]'`
- **THEN** `gaps` 状态 SHALL 被设置为该数组
- **AND** 正常渲染

## MODIFIED Requirements

### Requirement: `_SCENE_PROMPT` opening_line 输出约束
原 prompt 第 7 条（opening_line）扩展，新增输出约束：
- **必须是一句不超过 25 词的英文开场白**
- **禁止包含数字串（如订单号、ID）**
- **禁止连续 dash（--- / ——）**
- **禁止 JSON 残留（如引号、括号、字段名）**
- **禁止编造具体菜单/产品名**（如果场景是咖啡店可以提"咖啡"但不提具体产品）

**新 prompt 第 7 条：**
```
7. opening_line: B角色（AI角色）的第一句开场白，必须满足：
   - 不超过 25 词
   - 引导用户围绕任务主题开口（问句或具体选项结尾）
   - 包含场景专有词（如咖啡店可用 "drink / order"，机场可用 "flight / gate"）
   - 禁止编造具体产品名（如 "vanilla latte / cappuccino"），用通用名词（"something to drink"）
   - 禁止数字串、连续 dash、JSON 残留
```

### Requirement: 诊断页 useEffect 数据提取
原 useEffect 直接 `setGaps(JSON.parse(raw))` 改为：
```ts
const parsed = JSON.parse(raw);
const gapList = Array.isArray(parsed) ? parsed : (parsed?.gaps ?? []);
setGaps(gapList);
```

## REMOVED Requirements

### Requirement: 任务页变体挑战区块
**Reason**：与"1 主目标 + ≤1 选子目标"任务规模约束冲突；用户测试反馈需要从任务页移除；attempt2 改用 `variantContext` localStorage 流程消费 `variant_plot`，不依赖任务页 UI。
**Migration**：attempt2/page.tsx 已支持从 `localStorage.variantContext` 读取 `variant_plot`，无需改动；VLM 生成的 `variant_plot` 仍持久化到 DB；用户进入 attempt2 的入口改为从首页/任务卡其他位置（暂未实现，本次仅删除 task 页相关 UI）。

## 设计权衡记录

| 决策 | 备选 | 选用理由 |
|------|------|----------|
| 任务页完全删除变体挑战（VLM 仍生成 `variant_plot`） | 完全不生成 `variant_plot` | DB schema 不破坏，attempt2 流程仍可用；不破坏回滚 |
| Loading modal 内嵌在 scenario 页 | 抽成通用组件 | 仅 1 处使用，组件化过度设计 |
| 倒计时直接用 `bg-primary` 工具类 | 读 CSS 变量写 inline style | Tailwind 已与 `--primary` 绑定，工具类最简 |
| 清洗 opening_line 在后端 | 前端清洗 | 后端是权威数据源，避免前端脏数据展示 |
| 诊断页兼容两种格式 | 强制统一为 `{gaps: []}` | 旧 localStorage 数据可能存在，兼容更稳 |

## 验收标准

- [ ] 任务页无 `变体挑战` 区块 + 无 `挑战变体情节` 按钮
- [ ] scenario 页 submitting=true 时显示全屏模糊 modal + 6-8 条轮换提示词 + 跳动圆点
- [ ] 倒计时数字颜色与网站主色一致（不再是 `bg-primary/10` 淡蓝刺眼）
- [ ] 后端 VLM 输出数字串 dash 组合时 `opening_line == ""`，前端降级到 `generate_opening`
- [ ] 诊断页 `gaps?.map is not a function` 报错消失，能正常渲染诊断卡片
- [ ] 旧 localStorage 数据（数组格式）仍能正常加载诊断页
- [ ] `npm run build` 通过
