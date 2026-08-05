# Tasks: Day9 录音波形 + 设备检测页 + AI 词典 + 隐藏逻辑审查

## Phase 1: 录音波形修复

- [ ] Task 1: attempt1 时域 RMS 波形 + 柱状图
  - [ ] 替换 getByteFrequencyData → getByteTimeDomainData + RMS 计算
  - [ ] 渲染 12 根柱状条
  - [ ] 验证：说话时柱高变化明显，安静时 < 10%

- [ ] Task 2: attempt1 录音按钮去除 150ms 延迟
  - [ ] onPointerDown 立即 beginRecord
  - [ ] onPointerUp / onPointerLeave 立即 endRecord
  - [ ] 验证：按下立即开始录音

- [ ] Task 3: attempt2 同步修复（波形 + 按钮）
  - [ ] 同步 attempt1 的两处修复
  - [ ] 验证

## Phase 2: 设备检测独立页

- [ ] Task 4: 新建 /device-check 页面
  - [ ] 摄像头实时预览（video）
  - [ ] 麦克风柱状条（10 根）
  - [ ] 状态指示（绿/红 + ✓/✗）
  - [ ] 失败原因（NotAllowedError / NotFoundError / NotReadableError 等）
  - [ ] "重新检测" + "返回"按钮
  - [ ] 写入 localStorage.device_check_passed=true
  - [ ] 验证

- [ ] Task 5: attempt1 设备检测入口 + 按钮置灰
  - [ ] 右上角"🎛 设备检测"按钮 → router.push("/device-check")
  - [ ] useEffect 读 localStorage.device_check_passed
  - [ ] 录音按钮置灰 + tooltip "请先完成设备检测"
  - [ ] 验证

- [ ] Task 6: attempt2 + facilitate 同步设备检测入口
  - [ ] attempt2: 入口 + 置灰
  - [ ] facilitate: 入口 + 录音/录制按钮置灰
  - [ ] 验证

## Phase 3: AI 词典

- [ ] Task 7: 新建 lib/translation.ts（前端直连豆包）
  - [ ] translateWord(word): Promise<{translation, phonetic}>
  - [ ] 直接 fetch https://ark.cn-beijing.volces.com/api/v3/chat/completions（doubao-seed-2-0-mini-260428）
  - [ ] prompt：英汉词典 JSON {translation, phonetic}，translation 15 字以内
  - [ ] localStorage poa_word_cache 缓存（30 天）
  - [ ] 失败降级

- [ ] Task 8: 新建 components/WordTooltip.tsx
  - [ ] Popover 显示翻译 + 音标 + 收藏
  - [ ] 加载/错误状态

- [ ] Task 9: attempt1/attempt2 AI 消息词点击
  - [ ] 拆词正则 /\b[a-zA-Z']+\b/g
  - [ ] 每个词 span 可点击
  - [ ] 验证：点击 "latte" 显示翻译

- [ ] Task 10: diagnosis/evaluate/report AI 文本词点击
  - [ ] diagnosis: 诊断文本/反馈
  - [ ] evaluate: 评语/建议
  - [ ] report: 报告内容
  - [ ] 验证

## Phase 4: 隐藏逻辑审查

- [ ] Task 11: facilitate 页审查
  - [ ] 列出所有 if (!x) return / hidden / display:none
  - [ ] 评估合理性
  - [ ] 修复明显 bug

- [ ] Task 12: diagnose 页审查
  - [ ] 同上

- [ ] Task 13: evaluate 页审查
  - [ ] 同上

- [ ] Task 14: 输出审查报告
  - [ ] docs/day9-hidden-logic-audit.md
  - [ ] 列出所有位置 + 评估

## Phase 5: 验证 + 推送

- [ ] Task 15: 端到端测试 + commit + push main + 同步 day7-final
  - [ ] 验证所有功能
  - [ ] commit & push

# Task Dependencies

- Task 3 依赖 Task 1 + Task 2
- Task 6 依赖 Task 4 + Task 5
- Task 8 依赖 Task 7
- Task 9 依赖 Task 7 + Task 8
- Task 10 依赖 Task 9
- Task 15 依赖所有 Phase 1-4
