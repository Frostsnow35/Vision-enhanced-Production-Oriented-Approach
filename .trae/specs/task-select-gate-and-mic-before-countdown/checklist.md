# Checklist

- [x] 首次访问 attempt1 无任务时显示 HistoryTaskSelector 而非空白页
- [x] 首次访问 attempt2 无任务时显示 HistoryTaskSelector 而非空白页
- [x] 首次访问 diagnosis 无任务时显示 HistoryTaskSelector 而非空白页
- [x] 首次访问 evaluate 无任务时显示 HistoryTaskSelector 而非空白页
- [x] 首次访问 facilitate 无任务时显示 HistoryTaskSelector 而非空白页
- [x] 首次访问 report 无任务时显示 HistoryTaskSelector 而非空白页
- [x] 选择历史任务后页面刷新，进入正常内容
- [x] 会话中已选任务，返回页面直接进入正常内容，不拦截
- [x] attempt1 倒计时前等待麦克风就绪（micStatus === "ready"）
- [x] attempt2 倒计时前等待麦克风就绪（micStatus === "ready"）
- [x] 麦克风超时或失败时降级继续，不阻塞用户
