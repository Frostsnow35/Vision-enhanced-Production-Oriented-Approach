# Checklist

## Task 1: 删除任务页变体挑战
- [x] `poa-project/poa-frontend/src/app/task/page.tsx` 第 194-204 行的 `{/* 变体挑战 */}` 区块已删除
- [x] `poa-project/poa-frontend/src/app/task/page.tsx` 第 230-245 行的 `{task.variant_plot && (...)}` 按钮区块已删除
- [x] grep `variant_plot` 在 task/page.tsx 中为 0 处
- [x] "开始初次产出" 按钮居右独占

## Task 2: 场景分析趣味 loading modal
- [x] `poa-project/poa-frontend/src/app/scenario/page.tsx` `submitting=true` 时显示全屏模糊遮罩 + 居中卡片
- [x] 遮罩使用 `backdrop-blur-md bg-background/80`
- [x] 卡片含图标 + 标题 + 7 条轮换提示词
- [x] 提示词每 3 秒切换一条
- [x] 卡片底部 3 个跳动圆点
- [x] 模态消失时机：submitting=false 时立即消失

## Task 3: 倒计时配色
- [x] `poa-project/poa-frontend/src/components/CountdownEffect.tsx` 光晕大小从 64/48/32 改为 48/36/24
- [x] 颜色不再硬编码 `rgba(59,130,246,...)` 蓝色
- [x] 数字颜色与网站主色一致
- [x] 视觉上不刺眼

## Task 4: VLM 输出清洗
- [x] `poa-project/poa-backend/services/ai_service.py` 新增 `_sanitize_opening_line()` 和 `_sanitize_closing_line()` 函数
- [x] 检测 `^\d+(-\d+)+$` 模式 → 返回 `""`（已验证："12-3-45-67" → ''）
- [x] 长度 > 25 词 → 截断
- [x] 与 closing_line 相同 → 返回 `""`
- [x] 检测编造产品名（vanilla latte / cappuccino / cold brew 等）→ 返回 `""`（已验证："vanilla lattes, cappuccinos, cold brew" → ''）
- [x] `_SCENE_PROMPT` 第 7 条追加禁止约束
- [x] `analyze_scenario()` 调用清洗函数

## Task 5: 诊断页数据格式修复
- [x] `poa-project/poa-frontend/src/app/diagnosis/page.tsx` useEffect 改为兼容数组和 `{gaps: []}` 两种格式
- [x] 不再抛 `gaps?.map is not a function` 错误
- [x] 旧 localStorage 数组数据仍能正常加载
- [x] 新 `{gaps: []}` 数据能正确提取

## Task 6: 端到端验证
- [x] scenario → task → attempt1 → diagnosis 全流程跑通
- [x] 任务页无变体挑战
- [x] scenario 分析中 modal 出现 + 提示词轮换
- [x] 倒计时配色不刺眼
- [x] `npm run build` exit code 0
