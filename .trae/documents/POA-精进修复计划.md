# POA 平台精进修复计划

## 一、需求摘要

| 编号 | 需求 | 目标描述 |
|------|------|----------|
| R1 | **音频评分（核心）** | 后端新增本地音频分析模块，用 Whisper 词级时间戳提取发音置信度 + 流利度指标，替代当前七维评价中"发音标准度"和"副语言匹配度"两个维度的假数据（固定2.5）。架构预留扩展点，后续可接入 librosa 做韵律分析。 |
| R2 | **任务筛选+对话质量** | 控制预生成任务数量（维持6个精选样例），改进 VLM 场景分析 Prompt 让任务更多样化，修复开场白千篇一律的问题。 |
| R3 | **UI 综合优化** | 视觉风格、交互体验、信息呈现三维度打磨8个页面。（本期先做R1+R2，R3排后） |

**执行优先级：R1 + R2 先行，R3 后续。**

---

## 二、当前状态分析

### 2.1 音频链路现状

```
浏览器 MediaRecorder(webm/opus) → POST /api/upload/audio → 后端保存文件
  → Whisper base 转写为纯文本 → 文本交给豆包 LLM 分析
```

**病灶**：语音在转写环节被"降维"成纯文本，发音特征（音准、重音、连读）和副语言特征（语调、语速、停顿、情感色彩）全部丢失。

**代码证据**：

- `evaluate_service.py:35`：Prompt 明确写"若仅有文本无音频，给固定分 2.5"
- `evaluate_service.py:41`：Prompt 明确写"若无视频流，给固定分 2.5"
- `evaluate_service.py:210-216`：Mock 降级时所有维度随机分数（无音频信息可用）
- `asr_service.py:49-69`：Whisper 只返回 `result["text"]`，丢弃了 `segments` 中的时间戳和置信度

### 2.2 任务质量现状

- **预生成任务数量**：`sample_images/` 下6张图（cafe, restaurant, airport, mall, library, hospital）
- **开场白问题**：`chat_service.py:72-139`
  - LLM 生成的 Prompt（第22-29行）过于简单，没有注入场景细节
  - Mock 降级（第117-139行）只有6条硬编码模板，场景区分度极低
  - 变体开场白只有3条（做错单/优惠/默认）
- **VLM 分析 Prompt**：`ai_service.py:212` 附近，需改进多样性和 POA 教学适配度

### 2.3 关键文件清单

| 文件 | 本次改动类型 |
|------|------------|
| `poa-backend/services/audio_analysis_service.py` | **新建** |
| `poa-backend/services/evaluate_service.py` | **修改**：接入音频分析结果 |
| `poa-backend/services/asr_service.py` | **修改**：返回词级时间戳 |
| `poa-backend/services/chat_service.py` | **修改**：改进开场白生成 |
| `poa-backend/services/ai_service.py` | **修改**：改进VLM分析Prompt |
| `poa-backend/config.py` | **修改**：新增音频分析开关 |
| `poa-backend/requirements.txt` | **修改**：新增依赖（如有） |
| `poa-frontend/src/app/evaluate/page.tsx` | **轻改**：展示真实发音分 |
| `poa-frontend/src/app/facilitate/page.tsx` | **轻改**：展示真实发音分 |

---

## 三、具体改造方案

### 模块A：音频分析服务（R1 核心）

#### A.1 新建 `services/audio_analysis_service.py`

**职责**：接收音频文件路径 → 返回发音评分 + 流利度评分

**实现策略**：利用 Whisper 的 `word_timestamps` 功能提取声学特征，不引入额外重量级依赖。

```python
# 核心函数签名

def analyze_audio(audio_path: str) -> AudioAnalysisResult:
    """
    @brief 分析音频文件，提取发音和流利度指标
    @param audio_path 音频文件路径（webm/wav）
    @return AudioAnalysisResult {pronunciation_score, fluency_score, metrics}
    """
```

**评分算法**：

| 维度 | 子指标 | 计算方式 | 权重 |
|------|--------|----------|------|
| 发音标准度 | 词级置信度均值 | `np.mean([seg.confidence for seg in segments])` (Whisper 返回 0~1) | 60% |
| 发音标准度 | 低置信词占比 | `count(conf < 0.6) / total_words` | 40% |
| 流利度 | 语速 (WPM) | `total_words / total_duration_minutes` | 40% |
| 流利度 | 停顿频率 | `pause_count / total_duration_minutes` (停顿=词间间隔>0.5s) | 30% |
| 流利度 | 平均停顿时长 | `np.mean([gap for gap in gaps if gap > 0.5])` | 30% |

**分数映射**：将原始指标映射到 1.0~5.0 的七维评分尺度。

- 发音置信度 0.9+ → 5.0, 0.8→4.0, 0.7→3.0, 0.6→2.0, <0.6→1.0
- 流利度 WPM 120+→5.0, 100→4.0, 80→3.0, 60→2.0, <60→1.0

**降级策略**：
- Whisper 不可用时返回 None → evaluate_service 沿用当前 Mock 降级
- 音频文件不存在/损坏 → 返回 None
- 通过 `config.ENABLE_AUDIO_ANALYSIS` 开关控制

**扩展预留**（为后续 R1-进阶做准备）：
- 返回结果中包含 `raw_metrics` 字典，存储原始数值（pause_durations, word_confidences 等）
- 预留 `analyze_prosody()` 函数签名（空实现，后续接入 librosa）

#### A.2 改造 `services/asr_service.py`

**当前问题**：`transcribe_audio()` 只返回 `result["text"]`，丢弃了所有时间戳信息。

**改造**：增加 `transcribe_audio_with_timestamps()` 函数，返回 `(text, segments)` 元组。

```python
def transcribe_audio_with_timestamps(audio_path: str) -> tuple[str, list[dict]]:
    """
    @return (full_text, segments)
    segments: [{"start": float, "end": float, "text": str, "confidence": float}, ...]
    """
```

同时保持原有 `transcribe_audio()` 不变（向后兼容）。

#### A.3 改造 `services/evaluate_service.py`

**改造点 1**：`evaluate_single()` 函数增加 `audio_path` 可选参数。

```python
def evaluate_single(
    conversation_text: str,
    task_context: Dict[str, Any],
    audio_path: Optional[str] = None  # 新增
) -> Dict[str, Any]:
```

**改造点 2**：当 `audio_path` 存在且音频分析可用时：

1. 调用 `analyze_audio(audio_path)` 获取发音分和流利度分
2. 将发音分注入 LLM Prompt 的 `scores.发音标准度`，Prompt 改为"发音分数由音频分析模块提供，请勿修改，comment 中注明'由音频分析自动评分'"
3. 将流利度分注入 `scores.副语言匹配度` 和 `scores.话语回合适配性` 的参考依据
4. 如果音频分析不可用，保持当前行为（LLM 给固定分 2.5 或 Mock 降级）

**改造点 3**：`evaluate_compare()` 同理增加 `audio1_path` / `audio2_path` 参数。

**改造点 4**：`evaluate_target_gaps()` 无需改（靶向评估只看文本层面的改善）。

#### A.4 改造 API 路由调用链

需要追踪从 API 到 evaluate_service 的调用链，确保 audio_path 能传递过来。

- `POST /api/evaluate-single`：需要增加 `audio_path` 字段
- `POST /api/evaluate-compare`：需要增加 `audio1_path` / `audio2_path` 字段

前端在调用这些接口时，需要把 `attempt1` 和 `attempt2` 中存储的 `audio_path` 一并传入。

#### A.5 前端改动（轻量）

- `evaluate/page.tsx`：调用评价 API 时携带 audio_path
- `facilitate/page.tsx`：调用评价 API 时携带 audio_path
- 发音维度展示时移除 Mock 标记，展示真实分数

---

### 模块B：任务筛选与对话质量（R1 第二部分）

#### B.1 改进 VLM 场景分析 Prompt（`ai_service.py`）

**当前问题**：VLM 分析返回的任务在不同场景下"说的东西都差不多"，角色和交际目标缺乏多样性。

**改造**：在 `analyze_scenario()` 的 Prompt 中增加：

1. **交际类型多样化指令**：要求 LLM 从不同交际类型中随机选择（请求服务、解决问题、询问信息、表达需求、协商条件等），避免总是"点单/问路"模式
2. **POA 驱动要素强化**：要求 roles 明确区分主动方和被动方，goal 有具体的产出标准
3. **变体情节差异化**：variant_plot 必须与主情节有实质差异（更换子任务、增加冲突、改变条件）

具体修改 `ai_service.py` 中 `analyze_scenario()` 的 system prompt。

#### B.2 改进开场白生成（`chat_service.py`）

**当前问题**：
- LLM Prompt 过于简单（`_OPENING_PROMPT` 只有5条规则）
- Mock 降级只有6条硬编码模板

**改造 1 —— LLM Prompt 增强**：

`_OPENING_PROMPT` 增加：
- 必须使用场景特有词汇（如咖啡店用"latte/americano/espresso"，机场用"boarding gate/check-in/luggage"）
- 必须体现角色身份的语气差异（服务员热情、医生专业、图书管理员温和）
- 必须根据 variant_context 调整开场策略（如做错单场景先道歉再询问）
- 禁止泛用开场（禁止"Hi there! What can I get for you today?"这种万能句）

**改造 2 —— Mock 降级模板扩展**：

`_mock_opening()` 改造为更丰富的模板系统：
- 每个场景准备 3~5 条不同风格的开场白
- 随机选择 + 缓存避免重复
- 每条模板包含场景特有词汇

示例（咖啡店）：
```
"Good morning! Our special today is a caramel latte. What would you like?"
"Hi! Are you in the mood for something hot or iced today?"
"Welcome to Brew & Co.! First time here? Our espresso is a local favorite."
```

#### B.3 任务数量控制

当前 6 个样例已合理，无需增减。但需要在 `pregenerate_tasks.py` 中增加**质量校验步骤**：

- 生成后检查：scene_label 非空、roles 非空、goal 非空、evaluation_criteria 至少3条
- 不合格的任务标记为 failed，不计入缓存
- 增加 `--validate-only` 参数用于纯校验模式

---

### 模块C：UI 综合优化（R2，本期仅规划设计，暂不实现）

#### C.1 视觉风格优化方向

| 页面 | 当前问题 | 优化方向 |
|------|----------|----------|
| `/scenario` | 上传区与历史选择区视觉权重失衡 | 加大上传区域，历史区改为横向卡片滚动 |
| `/task` | 任务卡信息密度过高 | 分层折叠展示，重点信息前置 |
| `/attempt1` | 对话区+录音区挤在同一屏 | 对话区占主体，录音区固定在底部 |
| `/diagnosis` | Gap 卡片平铺无层次 | 按严重程度排序，最严重高亮 |
| `/facilitate` | 4个Tab内容风格不统一 | 统一卡片样式，增加 Tab 间进度指示 |
| `/attempt2` | 与 attempt1 几乎一样 | 增加"新情境提示"区的视觉权重 |
| `/evaluate` | 雷达图+条形图+卡片全屏堆叠 | 分Section展示，增加"查看详情"折叠 |
| `/report/[id]` | 时间线卡片单调 | 增加图标+颜色编码区分阶段类型 |

#### C.2 交互体验优化方向

- 录音触发：增加键盘快捷键提示、录音倒计时动画、松手确认动画
- 对话滚动：新消息自动滚动到底部，手动上翻时不强制跳转
- Tab 切换：添加切换过渡动画
- 加载状态：统一骨架屏风格

#### C.3 信息呈现优化方向

- 评价雷达图：增加具体数值标注、对比基线参考
- Gap 诊断：每条 Gap 增加"严重程度指示条"和"改善建议"
- 证据链报告：增加"学习时长"、"进步幅度"等汇总数字

---

## 四、改造文件清单

| 文件 | 改动类型 | 改动量估计 |
|------|----------|-----------|
| `poa-backend/services/audio_analysis_service.py` | **新建** | ~200行 |
| `poa-backend/services/asr_service.py` | 修改 | +20行（新增函数） |
| `poa-backend/services/evaluate_service.py` | 修改 | +50行（接入音频） |
| `poa-backend/services/chat_service.py` | 修改 | +60行（Prompt+Mock模板） |
| `poa-backend/services/ai_service.py` | 修改 | +30行（VLM Prompt改进） |
| `poa-backend/config.py` | 修改 | +3行（新增开关） |
| `poa-backend/scripts/pregenerate_tasks.py` | 修改 | +30行（质量校验） |
| `poa-backend/routers/evaluate.py` | 修改 | +10行（传audio_path） |
| `poa-frontend/src/app/evaluate/page.tsx` | 修改 | +15行 |
| `poa-frontend/src/app/facilitate/page.tsx` | 修改 | +10行 |

---

## 五、假设与决策

| 决策点 | 决策 | 理由 |
|--------|------|------|
| 音频分析实现方式 | 利用 Whisper 词级时间戳 + 置信度 | 零额外依赖，Whisper 已集成，基础方案够用 |
| 发音评分算法 | 词级置信度均值 + 低置信词占比 | Whisper base 模型置信度与发音清晰度正相关 |
| 流利度评分算法 | WPM + 停顿频率 + 平均停顿时长 | 标准二语习得流利度指标 |
| 扩展预留 | `analyze_prosody()` 空函数 + `raw_metrics` | 后续接入 librosa/praat 时只需填充实现 |
| 任务数量 | 维持6个 | 用户明确"放少一点" |
| VLM Prompt 改进 | 增加交际类型多样化 + POA驱动强化 | 解决"不同场景说的东西差不多" |
| 开场白改进 | LLM Prompt 增强 + Mock 模板扩展双管 | 同时解决 LLM 路径和降级路径的千篇一律 |
| Python 版本 | 保持当前环境不变 | 不引入版本迁移风险 |
| 前端 UI 改造 | 本期规划设计，暂不实现 | 用户确认先做 R1+R2 |

---

## 六、验证方案

### R1 音频分析验证

1. **单元测试**：准备一段已知内容的英文录音，验证 `analyze_audio()` 返回合理的评分（1.0~5.0）
2. **集成测试**：完整走通 `/api/evaluate-single` 携带 `audio_path` 参数，验证返回的 `发音标准度` 不再是固定 2.5
3. **降级测试**：关闭 `ENABLE_AUDIO_ANALYSIS=false`，验证回退到当前 Mock 行为
4. **空音频测试**：传入空路径/损坏文件，验证返回 None 不抛异常

### R1 任务质量验证

1. **开场白多样性**：对6个场景分别调用 `generate_opening()` 5次，验证同一场景不重复、不同场景不雷同
2. **VLM 任务质量**：运行 `pregenerate_tasks.py --force --validate-only`，验证所有任务包含 scene_label/roles/goal/criteria
3. **对话完整性**：在 `/attempt1` 完成一次对话，验证开场白包含场景特有词汇

---

## 七、风险与注意事项

| 风险 | 缓解措施 |
|------|----------|
| Whisper base 模型词级置信度不准确 | 如果置信度波动大，降低权重，增加低置信词占比的惩罚力度 |
| Railway 部署环境 `ASR_ENABLED=false` | 音频分析同样依赖此开关，保持一致的降级行为 |
| 音频分析增加 API 响应时间（Whisper 二次加载） | `analyze_audio()` 复用 `asr_service` 的全局单例模型，不二次加载 |
| VLM Prompt 改坏导致任务不可用 | 保留原有 Prompt 作为 fallback，增加 `PREVIOUS_PROMPT` 备份 |
