"""
AI 服务 —— requests 直连豆包 Chat API。
所有函数: LLM 优先 → 失败自动降级 Mock → 返回格式固定。
"""
import hashlib
import json
import logging
import os

import time
import base64
import socket
from typing import Any, Dict, List

import httpx
from sqlalchemy.orm import Session

from config import DOUBAO_API_KEY, DOUBAO_BASE_URL, ARK_MODEL_ID, DOUBAO_MODEL_ID, DOUBAO_VISION_MODEL_ID
from models import Scenario, POATask

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("ai_service")

CHAT_URL = f"{DOUBAO_BASE_URL}/chat/completions"
_TIMEOUT = 120  # 文本模型默认超时
_VISION_TIMEOUT = 420  # 视觉模型超时（doubao-1.5-vision-pro-32k 首 token 60~120s，TCP keepalive 防断连）
_RETRY_COUNT = 2  # 指数退避重试次数（默认，视觉调用可覆盖为更少）
_RETRY_BACKOFF = 2.0  # 首次退避秒数
_MAX_TOKENS = 1000

# ============================================================
# TCP Keepalive —— 全局 monkey-patch socket.create_connection
# 确保每个 TCP 连接都设置 keepalive（30s 空闲即探测），
# 防止跨太平洋连接在 VLM 推理期间（60~120s 无数据）被中间网络设备断开。
# ============================================================
_orig_create_conn = socket.create_connection

def _patched_create_conn(address, timeout=None, source_address=None, **kwargs):
    sock = _orig_create_conn(address, timeout=timeout, source_address=source_address, **kwargs)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    # Linux: TCP_KEEPIDLE; macOS: TCP_KEEPALIVE
    for name in ("TCP_KEEPIDLE", "TCP_KEEPALIVE"):
        if hasattr(socket, name):
            try:
                sock.setsockopt(socket.IPPROTO_TCP, getattr(socket, name), 30)
            except OSError:
                pass
            break
    if hasattr(socket, "TCP_KEEPINTVL"):
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL, 10)
        except OSError:
            pass
    if hasattr(socket, "TCP_KEEPCNT"):
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPCNT, 3)
        except OSError:
            pass
    return sock

socket.create_connection = _patched_create_conn
logger.info("[LLM] TCP keepalive 全局 monkey-patch 已激活 (idle=30s, intvl=10s, cnt=3)")


# ============================================================
# 通用 LLM 调用
# ============================================================
def _call_doubao(messages: List[Dict[str, Any]], max_tokens: int = _MAX_TOKENS, model: str = "",
                 timeout: float = _TIMEOUT, max_retries: int | None = None) -> str:
    """调用豆包 API，返回 content。model 为空时使用默认模型。失败抛 RuntimeError。
    
    视觉/耗时调用使用 stream=True 以保持 TCP 连接活跃（防跨太平洋空闲断连）。
    """
    body = {
        "model": model or DOUBAO_MODEL_ID,
        "messages": messages,
        "max_tokens": max_tokens,
        "stream": True,  # 流式响应：即使 VLM 推理期间无输出，连接也不会因空闲被杀
    }
    headers = {"Authorization": f"Bearer {DOUBAO_API_KEY}", "Content-Type": "application/json"}

    retries = _RETRY_COUNT if max_retries is None else max_retries

    last_error = ""
    for attempt in range(1 + retries):
        t0 = time.time()
        try:
            # httpx.stream 返回的 response 需手动读取所有 chunk 并拼接
            full_content = ""
            full_reasoning = ""
            with httpx.stream(
                "POST", CHAT_URL, headers=headers, json=body,
                timeout=httpx.Timeout(connect=15.0, read=timeout, write=60.0, pool=10.0),
            ) as resp:
                status = resp.status_code
                if status != 200:
                    text = resp.read().decode(errors="replace")[:300]
                    elapsed = time.time() - t0
                    if status in (429, 500, 502, 503, 504):
                        last_error = f"HTTP {status}: {text}"
                        logger.warning(f"  [LLM] attempt {attempt+1}/{1+retries} {last_error} ({elapsed:.1f}s)")
                        if attempt < retries:
                            wait = _RETRY_BACKOFF * (2 ** attempt)
                            logger.info(f"  [LLM] 等待 {wait:.0f}s 后重试...")
                            time.sleep(wait)
                            continue
                    resp.raise_for_status()

                # 逐行读取 SSE 流，拼接 content
                for line in resp.iter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    data_str = line[6:]  # 去掉 "data: " 前缀
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        choices = data.get("choices", [])
                        if choices:
                            delta = choices[0].get("delta", {})
                            full_content += delta.get("content", "") or ""
                            reasoning_delta = delta.get("reasoning_content", "") or ""
                            full_reasoning += reasoning_delta
                    except json.JSONDecodeError:
                        continue

            elapsed = time.time() - t0

            content = full_content.strip()
            reasoning = full_reasoning.strip()

            # 修复 thinking 模型输出的 content 为残片（如仅 "}"）的问题
            if len(content) < 20 and reasoning and len(reasoning) > len(content):
                import re as _re
                m = _re.search(r'\{[^{}]*"gaps"|\{[^{}]*"scores"|\{[^{}]*"comparison"|\{[^{}]*"scene_label"|\{[^{}]*"label"', reasoning)
                if m:
                    tail = reasoning[m.start():]
                    try:
                        _parse_json(tail)
                        content = tail
                    except Exception:
                        pass

            import re as _re
            content = _re.sub(r'</?think[^>]*>', '', content)
            logger.info(f"  [LLM] {status} {elapsed:.1f}s model={body['model'][:30]} len={len(content)}")
            return content

        except httpx.TimeoutException as e:
            elapsed = time.time() - t0
            last_error = str(e)
            logger.warning(f"  [LLM] attempt {attempt+1}/{1+retries} httpx.Timeout ({elapsed:.1f}s): {last_error}")
            if attempt < retries:
                wait = _RETRY_BACKOFF * (2 ** attempt)
                logger.info(f"  [LLM] 等待 {wait:.0f}s 后重试...")
                time.sleep(wait)
                continue
            raise RuntimeError(f"API 调用超时（已重试{retries}次）: {last_error}")

        except httpx.HTTPError as e:
            elapsed = time.time() - t0
            last_error = str(e)[:200]
            logger.warning(f"  [LLM] attempt {attempt+1}/{1+retries} httpx error ({elapsed:.1f}s): {last_error}")
            if attempt < retries:
                wait = _RETRY_BACKOFF * (2 ** attempt)
                logger.info(f"  [LLM] 等待 {wait:.0f}s 后重试...")
                time.sleep(wait)
                continue
            raise RuntimeError(f"API 调用失败（已重试{retries}次）: {last_error}")

    raise RuntimeError(f"API 调用失败（已重试{retries}次）: {last_error}")


def _parse_json(raw: str) -> Any:
    """去除 markdown 代码块后解析 JSON，仅提取第一个 JSON 对象/数组。"""
    import re
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        if lines[0].startswith("```"): lines = lines[1:]
        if lines and lines[-1].startswith("```"): lines = lines[:-1]
        raw = "\n".join(lines)

    # 处理 LLM 在 JSON 前加解释文字的情况（如 "好的，这是分析结果：\n{...}"）
    raw = raw.strip()
    # 如果 raw 不是以 { 或 [ 开头，找到第一个 { 或 [ 的位置
    if not raw.startswith("{") and not raw.startswith("["):
        brace_idx = raw.find("{")
        bracket_idx = raw.find("[")
        if brace_idx != -1 or bracket_idx != -1:
            start = min(i for i in (brace_idx, bracket_idx) if i != -1)
            raw = raw[start:]

    # 提取第一个完整 JSON 对象或数组（处理 LLM 追加额外文本的情况）
    if raw.startswith("{"):
        # 找到匹配的 }
        depth, end = 0, 0
        for i, ch in enumerate(raw):
            if ch == "{": depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0: end = i + 1; break
        if end: raw = raw[:end]
    elif raw.startswith("["):
        depth, end = 0, 0
        for i, ch in enumerate(raw):
            if ch == "[": depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0: end = i + 1; break
        if end: raw = raw[:end]

    # 移除尾部逗号（LLM 高频输出模式：{"key": "value",}）
    raw = re.sub(r',\s*([}\]])', r'\1', raw)

    return json.loads(raw)


_INVALID_PATTERNS = ("[语音消息]", "[voice message]", "[audio]", "[inaudible]", "[unintelligible]")

def _is_empty_or_placeholder(text: str) -> bool:
    """检查文本是否为空/空格/语音占位符，表示无有效输入。"""
    t = text.strip()
    if not t: return True
    if len(t) < 5: return True
    for p in _INVALID_PATTERNS:
        if p in t.lower(): return True
    return False

import re as _re
_DIGIT_DASH_RE = _re.compile(r"^\s*[\d]+([\s\-—_]+[\d]+)+\s*$")
_REPEATED_DASH_RE = _re.compile(r"[-—_]{3,}")
_JSON_RESIDUE_RE = _re.compile(r'[\{\}\[\]"]|"\w+":|^\s*\{|\}\s*$')
_PRODUCT_HALLUCINATION_RE = _re.compile(
    r"\b(vanilla latte|cappuccino|espresso|macchiato|frappuccino|"
    r"cold brew|iced latte|matcha latte|caramel macchiato)\b", _re.IGNORECASE
)
# 时间戳格式 "YYYY-MM-DD" (如 2024-01-15) 或 "YYYY/MM/DD"
_TIMESTAMP_DATE_RE = _re.compile(r'\b\d{2,4}[-/]\d{1,2}[-/]\d{1,2}\b')
# 时间格式 "HH:MM" 或 "HH:MM:SS" 或 "HH:MM AM/PM"
_TIMESTAMP_TIME_RE = _re.compile(r'\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?\b')
# 纯数字串（5位及以上连续数字）
_PURE_NUMBER_RE = _re.compile(r'\b\d{5,}\b')


def _sanitize_opening_line(raw: str, closing_line: str = "") -> str:
    """
    清洗 VLM 输出的 opening_line。
    - 空串 / 纯数字串+dash 组合（"12-3-45-67"）/ 连续 dash / JSON 残留 → 返回 ""
    - 长度 > 25 词 → 截断到 25 词
    - 与 closing_line 相同 → 返回 ""（避免复用）
    - 含具体产品名（vanilla latte / cappuccino 等）→ 返回 ""（避免编造）
    - 清洗后为空时，前端 chatStart 降级到 generate_opening
    """
    if not raw:
        return ""
    text = raw.strip()
    if not text:
        return ""
    # 1. 数字串 + dash 组合
    if _DIGIT_DASH_RE.match(text):
        return ""
    # 2. 连续 dash
    if _REPEATED_DASH_RE.search(text):
        return ""
    # 3. JSON 残留
    if _JSON_RESIDUE_RE.search(text):
        return ""
    # 4. 与 closing_line 相同
    if closing_line and text.strip().lower() == closing_line.strip().lower():
        return ""
    # 5. 含具体产品名（编造）
    if _PRODUCT_HALLUCINATION_RE.search(text):
        return ""
    # 6. 时间戳日期格式
    if _TIMESTAMP_DATE_RE.search(text):
        return ""
    # 7. 时间格式 HH:MM
    if _TIMESTAMP_TIME_RE.search(text):
        return ""
    # 8. 纯数字串
    if _PURE_NUMBER_RE.search(text):
        return ""
    # 9. 长度截断
    words = text.split()
    if len(words) > 25:
        text = " ".join(words[:25])
    return text


def _sanitize_closing_line(raw: str) -> str:
    """
    清洗 VLM 输出的 closing_line。
    - 空串 / 数字串 / JSON 残留 → 返回 ""
    - 长度 > 30 词 → 截断
    """
    if not raw:
        return ""
    text = raw.strip()
    if not text:
        return ""
    if _DIGIT_DASH_RE.match(text):
        return ""
    if _REPEATED_DASH_RE.search(text):
        return ""
    if _JSON_RESIDUE_RE.search(text):
        return ""
    # 4. 时间戳日期格式
    if _TIMESTAMP_DATE_RE.search(text):
        return ""
    # 5. 时间格式 HH:MM
    if _TIMESTAMP_TIME_RE.search(text):
        return ""
    # 6. 纯数字串
    if _PURE_NUMBER_RE.search(text):
        return ""
    words = text.split()
    if len(words) > 30:
        text = " ".join(words[:30])
    return text

_NO_VALID_INPUT = {"error": "no_valid_input", "message": "未检测到有效语音内容，请重新录音。"}


# ============================================================
# Prompt 模板
# ============================================================
_SCENE_PROMPT = """根据照片内容，直接输出以下JSON（只输出JSON，禁止任何额外文字）：

{
  "scene_label": "具体场景名如Cafe Brew & Co.",
  "poa_task": {
    "roles": "A:普通顾客/访客/乘客等无专业背景角色; B:场景专业服务人员",
    "goal": "1个交际主目标（含产出标准如'用委婉句式点单'）",
    "context_constraints": "1~2条场景特定约束",
    "evaluation_criteria": ["维度1如'请求句式多样性'", "维度2如'信息确认的准确性'", "维度3如'回应的恰当性'"]
  },
  "variant_plot": "同场景同角色的新情节（仅改一个交际维度，如点单→纠正订单）",
  "opening_line": "B的开场白（含场景专有词+?结尾问句引导）",
  "closing_line": "B的场景化告别（≤30词）"
}

规则: A必须是无专业背景的普通人，B是专业服务方。evaluation_criteria从A角度出发，禁用'准确性''流利度'等通用标签。禁用泛化开场白/告别。"""

_DIAGNOSIS_PROMPT = """你是英语口语诊断专家。找出学生对话中的 Top 3 不足，返回 JSON:
{"gaps":[{"label":"不足分类","evidence_sentence":"原文证据","explanation":"为什么需要改进及正确建议"}]}"""

_SINGLE_PROMPT = """你是英语口语评估专家。请严格按照以下七维标准评分(1-5,精确到0.1)，并写中文评语。返回 JSON:
{"scores":{"发音标准度":0,"语法规范性":0,"词汇适配性":0,"语言功能达成度":0,"语用策略得体性":0,"话语回合适配性":0,"副语言匹配度":0},
 "comments":{"发音标准度":"评语","语法规范性":"评语","词汇适配性":"评语","语言功能达成度":"评语","语用策略得体性":"评语","话语回合适配性":"评语","副语言匹配度":"评语"}}

【七维评分锚点 — 必须严格参照】
1.发音标准度: 1=音素错误>=35%,可懂度<50% | 3=错误<15%,可懂度>=70% | 5=无系统性错误,可懂度>=90%,连读弱读自然。基于文本特征推断：句式完整流畅则发音清晰度较高(3-5分)；句式碎片化则可能发音生硬(1-3分)
2.语法规范性: 1=错误率>=35%,句子混乱 | 3=错误<15%,核心意思可懂 | 5=错误<5%,稳定正确,能使用复杂结构
3.词汇适配性: 1=用词与场景脱节 | 3=基本匹配,准确率>=70% | 5=高度匹配,搭配地道
4.语言功能达成度: 1=任务完成率<50% | 3=完成率>=70%,意图可理解 | 5=完成率>=85%,高效完成
5.语用策略得体性: 1=礼貌表达率<30%,生硬 | 3=礼貌率>=50%,使用基础句式 | 5=礼貌率>=85%,灵活调整策略
6.话语回合适配性: 1=话轮失衡>=50%,无转换信号 | 3=失衡<30%,有基础转换 | 5=失衡<10%,熟练使用多种转换句式
7.副语言匹配度: 基于文本特征推断流利度和节奏感：有衔接词则流利度较高(3-5分)；直接作答则偏低(1-3分)；有完整对话闭合则节奏感好

【评语要求】每个 comment 必须引用对话中的具体证据(原句或描述)，长度 20-60 字。发音和副语言维度的评语直接引用文本证据说明，不提及"无音频"或"由文本推断"。"""

_COMPARE_PROMPT = """你是英语口语评估专家。对比初次和二次对话，对七维逐项打分并写对比评语。返回 JSON:
{"comparison":[
  {"dimension":"发音标准度","attempt1_score":2.5,"attempt2_score":3.5,"change":"+1.0",
   "comment":"评语（必须引用两次对话的原文举例，清晰说明分数变化原因）"}]}

【七维评分锚点 — 与单次评估标准完全一致】
1.发音标准度: 1=音素错误>=35%,可懂度<50% | 3=错误<15%,可懂度>=70% | 5=无系统性错误,可懂度>=90%。基于文本推断：句式复杂度提升则发音清晰度随之改善
2.语法规范性: 1=错误率>=35% | 3=错误<15% | 5=错误<5%,稳定正确
3.词汇适配性: 1=用词脱节 | 3=基本匹配>=70% | 5=高度匹配,搭配地道
4.语言功能达成度: 1=完成率<50% | 3=>=70% | 5=>=85%,高效完成
5.语用策略得体性: 1=礼貌率<30% | 3=>=50% | 5=>=85%,灵活策略
6.话语回合适配性: 1=失衡>=50% | 3=<30% | 5=<10%,熟练转换
7.副语言匹配度: 基于文本推断流利度和节奏感变化：衔接词增加则流利度提升；句式变丰富则节奏感改善

【对比评语要求】
每个 comment 必须包含: 1)初次产出中的具体证据(原句) 2)二次产出中的具体证据(原句) 3)进步或退步的具体原因。发音和副语言维度的评语直接引用文本证据说明变化，不提及"无音频"或"由文本推断"。
示例: "初次使用了 'I want coffee'(祈使句直接), 二次改为 'Could I have a latte, please?'(委婉请求+please), 礼貌策略从直接型升级为委婉型,语用得体性显著提升。"
"""

_EXERCISES_PROMPT = """你是英语教学练习设计专家。根据学生的不足列表，设计2~3道练习题。返回 JSON:
{"exercises":[{"id":1,"type":"multiple_choice","gap_target":"对应的不足标签","question":"题目描述","options":[{"key":"A","text":"选项A"},{"key":"B","text":"选项B"},{"key":"C","text":"选项C"}],"answer":"B","feedback":"详细解释为什么选这个答案"}]}
type 是 multiple_choice 或 fill_in_blank。每个练习必须针对具体的不足，题干使用中文，选项/答案使用英文。"""

_INPUTPACK_PROMPT = """你是英语教学材料设计师。根据学生的不足列表，设计学习材料。返回 JSON:
{"scene_chunks":[{"chunk":"英文短语","meaning":"中文释义","usage":"使用场景"}],
 "functional_sentences":[{"function":"功能名","sentence":"英文例句"}],
 "demo_dialogue":"示范对话(英文,标注说话人)",
 "strategy_tip":"学习策略提示(中文)"}"""


# ============================================================
# 1. 场景分析
# ============================================================
def analyze_scenario(image_path: str) -> Dict[str, Any]:
    logger.info(f"[analyze_scenario] path={image_path}")
    if not os.path.isfile(image_path):
        raise RuntimeError(f"视觉模型调用失败: 文件不存在 {image_path}")

    try:
        ext = os.path.splitext(image_path)[-1].lower()
        mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        data_url = f"data:{mime};base64,{b64}"
    except OSError as e:
        raise RuntimeError(f"视觉模型调用失败: 读取图片失败 {e}")

    try:
        raw = _call_doubao([{"role": "user", "content": [
            {"type": "text", "text": _SCENE_PROMPT},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]}], model=ARK_MODEL_ID, timeout=_VISION_TIMEOUT, max_tokens=500, max_retries=0)
    except Exception as e:
        raise RuntimeError(f"视觉模型调用失败: API请求失败 {e}")

    try:
        p = _parse_json(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"视觉模型调用失败: JSON解析失败 {e}")

    poa = p.get("poa_task", {})
    ec = poa.get("evaluation_criteria", [])
    if isinstance(ec, list):
        ec = "\n".join(f"{i}. {c}" for i, c in enumerate(ec, 1))
    cc = poa.get("context_constraints", "")
    if isinstance(cc, list):
        cc = "\n".join(c for c in cc)

    raw_opening = p.get("opening_line", "")
    raw_closing = p.get("closing_line", "")
    # 清洗 opening_line / closing_line：剔除数字串 dash 组合、JSON 残留、编造产品等
    sanitized_opening = _sanitize_opening_line(raw_opening, closing_line=raw_closing)
    sanitized_closing = _sanitize_closing_line(raw_closing)

    result = {
        "scene_label": p.get("scene_label", ""),
        "roles": poa.get("roles", ""),
        "goal": poa.get("goal", ""),
        "context_constraints": cc,
        "evaluation_criteria": ec if isinstance(ec, str) else str(ec),
        "variant_plot": p.get("variant_plot", ""),
        "opening_line": sanitized_opening,
        "closing_line": sanitized_closing,
    }
    if not sanitized_opening:
        logger.info(f"  [analyze_scenario] opening_line 清空（原始: {raw_opening[:60]!r}），前端将降级到 generate_opening")
    logger.info(f"  scene_label={result['scene_label']}")
    return result


# ============================================================
# 1b. 缓存查询
# ============================================================
def get_or_analyze_scenario(image_path: str, db: Session) -> Dict[str, Any]:
    try:
        with open(image_path, "rb") as f:
            h = hashlib.md5(f.read()).hexdigest()
    except OSError:
        return analyze_scenario(image_path)

    ex = db.query(Scenario).filter(Scenario.image_hash == h).first()
    if ex:
        t = db.query(POATask).filter(POATask.scenario_id == ex.id).order_by(POATask.created_at.desc()).first()
        if t:
            logger.info(f"[get_or_analyze] cache hit scenario_id={ex.id} task_id={t.id}")
            return {"scenario_id": ex.id, "task_id": t.id, "scene_label": ex.scene_label, "roles": t.roles or "", "goal": t.goal or "",
                    "context_constraints": t.context_constraints or "", "evaluation_criteria": t.evaluation_criteria or "",
                    "variant_plot": t.variant_plot or "",
                    "opening_line": t.opening_line or "", "closing_line": t.closing_line or ""}

    result = analyze_scenario(image_path)
    scenario_id = None
    task_id = None
    try:
        s = Scenario(image_path=image_path, image_hash=h, scene_label=result["scene_label"])
        db.add(s); db.flush()
        scenario_id = s.id
        t = POATask(scenario_id=s.id, roles=result["roles"], goal=result["goal"],
                     context_constraints=result["context_constraints"],
                     evaluation_criteria=result["evaluation_criteria"], variant_plot=result["variant_plot"],
                     opening_line=result.get("opening_line", ""), closing_line=result.get("closing_line", ""))
        db.add(t); db.flush()
        db.commit()
        task_id = t.id
        result["task_id"] = task_id
    except Exception as e:
        db.rollback(); logger.error(f"  DB write failed: {e}")
        # DB 写入失败不阻塞流程：用负数 ID 标记，确保前端仍能走通闭环
        task_id = -abs(hash(image_path + str(time.time()))) % 100000
        result["task_id"] = task_id
    result["scenario_id"] = scenario_id
    return result


# ============================================================
# 2. 产出诊断 → LLM 调用 + 降级 fallback
# ============================================================

# 诊断 prompt
_DIAGNOSIS_PROMPT = """\
你是一个严格、细致的英语口语诊断专家。仔细阅读学生的对话文本，结合场景和角色语境，找出真正存在问题的最多 4 条语言/语用不足（必须同时覆盖文本维度和基于文本特征推断的音频维度）。

【诊断维度要求】
- 必须至少包含 1 条文本维度（词汇/语法/语用/话轮）
- 必须至少包含 1 条基于文本特征反向推断的音频维度（发音清晰度/流利度/语调自然度/节奏感）
- 文本特征 → 音频表现的推断逻辑：
  - 句式碎片化、用词简单 → 推断发音可能较生硬、停顿偏多
  - 句式完整流畅、词汇准确 → 推断发音清晰、语调自然
  - 缺少衔接词 → 推断话轮衔接不够流畅
  - 有完整开场/回应/收尾 → 推断节奏感较好

【重要原则】
- 必须从对话中逐句寻找问题，不要套用模板化的常见错误
- 只有确认原文中确实存在该问题时才列出来
- 如果对话质量确实不错，可以减少 gap 数量（最少 1 条），不要无中生有
- 优先找出对学生交际效果影响最大的问题
- 音频维度的 label 要具体，如"发音清晰度-元音区分不足""流利度-句子连接不流畅""语调-缺少自然升降"

严格输出如下 JSON（不要输出其他内容）：
{
  "gaps": [
    {
      "label": "不足分类（文本维度如：请求句式-过于直接 / 时态混乱 / 词汇重复 / 话轮过长；音频维度如：发音清晰度-元音区分不足 / 流利度-句子连接不流畅 / 语调-缺少自然升降）",
      "evidence_sentence": "原文中的具体句子（必须逐字引用）",
      "reference_expression": "更自然/更准确的英文正确表达（必填，1 句话）",
      "explanation": "结合当前场景和角色，说明为什么需要改进。音频维度的 explanation 要自然融入文本证据，如'你的句子较短且多为简单词，由此推断发音时可能停顿较多，建议放慢语速清晰朗读每个词'"
    }
  ],
  "high_freq_errors": [
    {
      "phrase": "原文中反复出现的错误短语",
      "occurrence": 出现次数,
      "suggestion": "修正建议（1 句话）"
    }
  ]
}

要求：
- evidence_sentence 必须是从原文中逐字摘录的完整句子
- reference_expression 是地道的英语正确说法
- explanation 必须引用场景和角色，不能是泛泛而谈
- 音频维度解释不能提"无音频分析"或"由文本推断"，直接用自然措辞
- high_freq_errors 至少 1 条，最多 3 条，phrase 必须来自原文
"""
def diagnose_attempt(attempt_text: str, scene_context: str = "") -> Dict[str, Any]:
    """
    对学生的一次作答文本进行诊断，返回发现的语言/语用不足（Gap 格式）。
    直接调用真实 LLM，失败时抛出异常。
    """
    logger.info(f"[diagnose_attempt] text={attempt_text[:100]}... context={scene_context[:50]}")

    if not attempt_text.strip():
        logger.warning("[diagnose_attempt] 输入文本为空，返回空 gaps")
        return {"gaps": []}

    # 构建用户消息：场景信息 + 对话文本
    user_msg = f"场景信息：{scene_context}\n\n对话文本：\n{attempt_text}" if scene_context else attempt_text

    # 1. 尝试调用真实 LLM（文本模型）
    try:
        body = {
            "model": DOUBAO_MODEL_ID,
            "messages": [
                {"role": "system", "content": _DIAGNOSIS_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        }
        logger.info(f"[diagnose_attempt] 调用 LLM — model={DOUBAO_MODEL_ID}")
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                CHAT_URL,
                headers={
                    "Authorization": f"Bearer {DOUBAO_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()

        data = resp.json()
        raw = data["choices"][0]["message"]["content"].strip()
        # 去除 markdown 代码块包裹
        if raw.startswith("```"):
            lines = raw.split("\n")
            lines = lines[1:] if lines[0].startswith("```") else lines
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            raw = "\n".join(lines)
        parsed = json.loads(raw)
        logger.info(f"[diagnose_attempt] LLM 返回 {len(parsed.get('gaps',[]))} 条 gap, {len(parsed.get('high_freq_errors',[]))} 条高频错误")
        # 兜底字段（LLM 偶尔漏字段）
        if "gaps" not in parsed or not isinstance(parsed["gaps"], list):
            parsed["gaps"] = []
        if "high_freq_errors" not in parsed or not isinstance(parsed["high_freq_errors"], list):
            parsed["high_freq_errors"] = []
        return parsed

    except Exception as e:
        logger.error(f"[diagnose_attempt] LLM 调用失败: {e}")
        raise


# ============================================================
# 2.5 高频错误提取（phrase-level）
# ============================================================
_HIGHFREQ_PROMPT = """\
你是英语口语错误分析助手。分析学生的对话文本，找出 phrase-level 的高频错误（按出现频次降序）。
严格输出如下 JSON（不要输出其他内容）：
{
  "high_freq_errors": [
    {
      "phrase": "学生反复使用的错误短语（必须出现在原文中）",
      "occurrence": 出现次数（整数，最少 2）,
      "suggestion": "修正建议（1 句话，英文）"
    }
  ]
}

要求：
- 至少 1 条，最多 3 条
- phrase 必须在原文中真实出现过 2 次以上
- occurrence 必须真实反映出现次数，不要夸大
- 如果找不到符合条件的高频错误，返回空数组
"""


def _extract_high_freq_errors(attempt_text: str) -> List[Dict[str, Any]]:
    """
    从 attempt_text 中提取 phrase-level 高频错误（LLM 单次调用）。
    失败时返回空列表。
    """
    if not attempt_text or not attempt_text.strip() or len(attempt_text) < 50:
        return []
    try:
        body = {
            "model": DOUBAO_MODEL_ID,
            "messages": [
                {"role": "system", "content": _HIGHFREQ_PROMPT},
                {"role": "user", "content": attempt_text},
            ],
        }
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(
                CHAT_URL,
                headers={
                    "Authorization": f"Bearer {DOUBAO_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            resp.raise_for_status()
        data = resp.json()
        raw = data["choices"][0]["message"]["content"].strip()
        if raw.startswith("```"):
            lines = raw.split("\n")
            lines = lines[1:] if lines[0].startswith("```") else lines
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            raw = "\n".join(lines)
        parsed = json.loads(raw)
        errors = parsed.get("high_freq_errors", [])
        if not isinstance(errors, list):
            return []
        # 字段兜底
        cleaned = []
        for e in errors:
            if not isinstance(e, dict):
                continue
            phrase = str(e.get("phrase", "")).strip()
            if not phrase:
                continue
            try:
                occ = int(e.get("occurrence", 1))
            except (TypeError, ValueError):
                occ = 1
            cleaned.append({
                "phrase": phrase[:100],  # 截断防止超长
                "occurrence": max(1, occ),
                "suggestion": str(e.get("suggestion", "")).strip()[:200],
            })
        return cleaned[:3]
    except Exception as e:
        logger.warning(f"[high_freq_errors] 提取失败: {e}，返回空列表")
        return []


# ============================================================
# 3. 学习材料生成
# ============================================================
def generate_input_pack(gaps: List[Dict[str, Any]]) -> Dict[str, Any]:
    logger.info(f"[input_pack] gaps={len(gaps)}")
    try:
        gap_text = "\n".join(f"- {g.get('label','')}: {g.get('explanation','')}" for g in gaps)
        raw = _call_doubao([
            {"role": "system", "content": _INPUTPACK_PROMPT},
            {"role": "user", "content": f"学生不足:\n{gap_text}\n请生成针对性学习材料。"},
        ])
        result = _parse_json(raw)
        logger.info(f"  chunks={len(result.get('scene_chunks',[]))}")
        return result
    except Exception as e:
        logger.error(f"  LLM failed: {e}")
        raise


# ============================================================
# 4. 练习题生成（Mock，结构稳定无需 LLM）
# ============================================================
def generate_exercises(gaps: List[Dict[str, Any]]) -> Dict[str, Any]:
    logger.info(f"[exercises] gaps={len(gaps)}")
    try:
        gap_text = "\n".join(f"- [{g.get('label','')}] {g.get('explanation','')}" for g in gaps)
        raw = _call_doubao([
            {"role": "system", "content": _EXERCISES_PROMPT},
            {"role": "user", "content": f"学生不足:\n{gap_text}\n请生成2~3道针对性练习题。"},
        ], max_tokens=800)
        result = _parse_json(raw)
        logger.info(f"  exercises={len(result.get('exercises',[]))}")
        return result
    except Exception as e:
        logger.error(f"  LLM failed: {e}")
        raise
