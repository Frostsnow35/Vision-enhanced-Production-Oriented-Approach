# Checklist: Day9 录音波形 + 设备检测页 + AI 词典 + 隐藏逻辑审查

## Phase 1: 录音波形

- [ ] attempt1 使用 getByteTimeDomainData + 时域 RMS
- [ ] attempt1 波形渲染为 12 根柱状条
- [ ] attempt1 录音按钮去除 150ms 延迟
- [ ] attempt2 同步修复波形和按钮
- [ ] 说话时柱高明显波动
- [ ] 安静时柱高 < 10%
- [ ] 按下立即开始录音（< 50ms）
- [ ] 松开立即结束录音

## Phase 2: 设备检测独立页

- [ ] 新建 /device-check 页面
- [ ] 摄像头实时预览
- [ ] 麦克风柱状条
- [ ] 状态指示 ✓/✗
- [ ] 失败原因显示
- [ ] "重新检测" + "返回"按钮
- [ ] 通过时写入 localStorage.device_check_passed=true
- [ ] attempt1 右上角"🎛 设备检测"入口
- [ ] attempt2 入口
- [ ] facilitate 入口
- [ ] 设备未就绪时录音/录制按钮置灰
- [ ] 置灰按钮 hover 显示 tooltip

## Phase 3: AI 词典

- [ ] 模型职责分工说明已加入 spec.md
- [ ] 词典函数与对话/评估/促成的 LLM 角色严格区分（prompt 隔离）
- [ ] lib/translation.ts translateWord 函数
- [ ] LLM 调用 + JSON 解析（doubao-seed-2-0-mini-260428，前端直连）
- [ ] 严格 system prompt 限定为"英汉词典"角色
- [ ] localStorage poa_word_cache 缓存
- [ ] 失败降级
- [ ] components/WordTooltip.tsx Popover
- [ ] attempt1 AI 消息词可点击
- [ ] attempt2 词可点击
- [ ] diagnosis 词可点击
- [ ] evaluate 词可点击
- [ ] report 词可点击
- [ ] 点击词显示翻译 + 音标
- [ ] 缓存命中不重复调 LLM

## Phase 4: 隐藏逻辑审查

- [ ] facilitate 页 if (!x) return / hidden 全部列出
- [ ] diagnose 页同上
- [ ] evaluate 页同上
- [ ] docs/day9-hidden-logic-audit.md 报告输出
- [ ] 发现的明显 bug 已修复

## Phase 5: 部署

- [ ] 端到端测试
- [ ] commit
- [ ] push origin main
- [ ] 同步 origin day7-final
