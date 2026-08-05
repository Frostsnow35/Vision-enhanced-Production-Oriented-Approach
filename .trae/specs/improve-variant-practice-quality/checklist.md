# Checklist

- [x] `_SCENE_PROMPT` 中 variant_plot 行已从「实质差异」改为「同场景同角色、子任务变化、≤1个交际维度差异」
- [x] `_SCENE_PROMPT` 中包含好/坏变体示例对照
- [x] `_REPLY_PROMPT` 中包含「禁止单向承诺型回复」规则 + BAD/GOOD 示例
- [x] `_REPLY_PROMPT` 中包含「禁止连续反问不推进」规则 + BAD/GOOD 示例
- [x] `_REPLY_PROMPT` 中包含「禁止主题漂移」规则
- [x] `_OPENING_PROMPT` 中包含开场白必须反映变体情节方向的约束
- [x] 前端 `detectLowQualityReply()` 函数存在且实现三种检测规则
- [x] 死胡同检测正则匹配 "let me go ask" / "I'll check with" / "I need to confirm" 等模式
- [x] 连续反问检测可识别连续两轮纯反问
- [x] 主题偏离检测可从 variant_plot 提取关键词并与 AI 回复做交集判断
- [x] 低质量回复触发时显示「重新生成回复」按钮
- [x] 点击重试后旧 AI 回复被移除，新回复替换到位
- [x] 重试期间按钮处于加载态不可重复点击
- [x] 重试失败时保留原回复并提示用户
- [x] 正常质量回复不误显示重试按钮
- [x] attempt1 页面不受影响（未改动其代码）
- [x] API 契约不变（前端请求格式兼容）
