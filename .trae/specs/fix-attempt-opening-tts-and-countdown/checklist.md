# Checklist

- [x] CountdownEffect 倒计时结束后 attempt1 页面 AI 头像显示"正在说话..."并自动播放开场白语音
- [x] CountdownEffect 倒计时结束后 attempt2 页面 AI 头像显示"正在说话..."并自动播放开场白语音
- [x] API 失败时降级 mock 开场白仍通过 TTS 播放语音，不静默
- [x] 倒计时数字3/2/1/GO! 在黑色背景上清晰可见（白色字体+青色发光）
- [x] 倒计时光晕层为 cyan-400 半透明而非原先的 primary 深蓝
- [x] 豆包 TTS 生成的英文语音为纯正英文发音（无中文口音）
- [x] TTS 缓存命中时直接返回已生成文件，不重复调用 API
- [x] 豆包 TTS 失败时降级 gTTS 仍可用
- [x] pyttsx3 相关代码和 import 已移除
- [x] VLM 分析产出的 opening_line 经 scenario 页面存入 localStorage
- [x] attempt1 chatStart 调用携带 opening_line 参数
- [x] attempt2 chatStart 调用携带 opening_line 参数
- [x] 后端 chat/start 接收 opening_line 并优先使用
- [x] opening_line 清洗函数过滤 YYYY-MM-DD 格式时间戳
- [x] opening_line 清洗函数过滤 HH:MM 格式
- [x] opening_line 清洗函数过滤纯数字串
