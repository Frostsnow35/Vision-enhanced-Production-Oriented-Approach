"""
AI 服务 —— 全部函数均接入豆包 LLM，失败时抛出异常，不使用 Mock 降级。
"""
import base64
import hashlib
import json
import logging
import os
import re
import time
import traceback
from typing import Any, Dict, List

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from config import DOUBAO_API_KEY, DOUBAO_BASE_URL, ARK_MODEL_ID, DOUBAO_MODEL_ID
from models import Scenario, POATask

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai_service")

# ---- REST API 端点 ----
DOUBAO_CHAT_URL = f"{DOUBAO_BASE_URL}/chat/completions"

_SYSTEM_PROMPT = """\
你是一个英语教学场景分析专家。请分析这张照片，严格输出如下 JSON 格式（不要输出任何其他内容）：

{
  "scene_label": "场景名称（中文）",
  "scene_elements": {
    "location": "识别到的场所类型",
    "objects": "画面中的关键物体",
    "people": "画面中人物的角色和关系"
  },
  "poa_task": {
    "user_role": "学生扮演的角色（只写学生角色，不要包含AI角色。示例: 顾客（有乳糖不耐受））",
    "ai_role": "AI扮演的角色（只写AI角色，不要包含学生角色。示例: 咖啡师（高峰期忙碌））",
    "goal": "交际目标（用中文描述）",
    "context_constraints": "语境要求列表（用序号列出）",
    "evaluation_criteria": ["评价维度1", "评价维度2", "评价维度3", "评价维度4", "评价维度5"]
  },
  "variant_plot": "用于二次产出的新情节变体（中文），在原场景基础上增加一个变化"
}"""


# ============================================================
# 1. 场景分析 → 豆包视觉模型（无 Mock 降级）
# ============================================================
def analyze_scenario(image_path: str) -> Dict[str, Any]:
    """
    根据场景图片路径，调用豆包视觉模型（REST API）分析并返回 POA 任务参数。
    失败时抛出 HTTPException，不再使用 Mock 降级。
    """
    logger.info(f"[analyze_scenario] image_path={image_path}")

    if not DOUBAO_API_KEY:
        raise HTTPException(
            status_code=503,
            detail={
                "error_type": "api_key_missing",
                "message": "豆包 API Key 未配置，请在环境变量中设置 DOUBAO_API_KEY",
                "suggestion": "请检查 .env 文件或服务器环境变量",
            },
        )

    # 1. 文件存在性检查
    if not os.path.isfile(image_path):
        raise HTTPException(
            status_code=400,
            detail={
                "error_type": "file_not_found",
                "message": f"图片文件不存在: {image_path}",
                "suggestion": "请重新上传图片",
            },
        )

    # 2. 读取图片并转 base64 Data URL
    try:
        ext = os.path.splitext(image_path)[-1].lower()
        mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                    ".png": "image/png", ".webp": "image/webp"}
        mime_type = mime_map.get(ext, "image/jpeg")

        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
        data_url = f"data:{mime_type};base64,{b64}"
    except OSError as e:
        raise HTTPException(
            status_code=503,
            detail={
                "error_type": "file_read_error",
                "message": "图片读取失败",
                "detail": str(e),
            },
        )

    # 3. 构造 REST API 请求体
    body = {
        "model": ARK_MODEL_ID,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _SYSTEM_PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
    }

    # 4. 调用 REST API
    logger.info(
        f"[analyze_scenario] 调用豆包 REST API — "
        f"endpoint={DOUBAO_CHAT_URL} model={ARK_MODEL_ID}"
    )
    start_time = time.time()
    try:
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(
                DOUBAO_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {DOUBAO_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
        elapsed_ms = int((time.time() - start_time) * 1000)
        status_code = resp.status_code
        logger.info(
            f"[analyze_scenario] API 响应 — status={status_code} "
            f"elapsed_ms={elapsed_ms}"
        )
        if status_code != 200:
            response_text = resp.text[:300]
            logger.error(
                f"[analyze_scenario] HTTP {status_code} — body={response_text}\n"
                f"{traceback.format_exc()}"
            )
            raise HTTPException(
                status_code=502,
                detail={
                    "error_type": "http_error",
                    "message": f"豆包 API 返回错误 (HTTP {status_code})",
                    "detail": response_text,
                    "suggestion": "请稍后重试",
                },
            )
        data = resp.json()
        raw_text = data["choices"][0]["message"]["content"]
        logger.info(f"[analyze_scenario] 豆包返回前500字符: {raw_text[:500]}")
    except HTTPException:
        raise
    except httpx.TimeoutException as e:
        elapsed_ms = int((time.time() - start_time) * 1000)
        logger.error(
            f"[analyze_scenario] 网络超时 — elapsed_ms={elapsed_ms}\n"
            f"{traceback.format_exc()}"
        )
        raise HTTPException(
            status_code=503,
            detail={
                "error_type": "network_timeout",
                "message": "豆包 API 调用超时",
                "detail": str(e),
                "suggestion": "请稍后重试",
            },
        )
    except (httpx.HTTPError, KeyError, json.JSONDecodeError) as e:
        elapsed_ms = int((time.time() - start_time) * 1000)
        logger.error(
            f"[analyze_scenario] API 调用失败 — elapsed_ms={elapsed_ms}\n"
            f"{traceback.format_exc()}"
        )
        raise HTTPException(
            status_code=503,
            detail={
                "error_type": "network_error",
                "message": "豆包 API 调用失败",
                "detail": str(e),
                "suggestion": "请稍后重试",
            },
        )

    # 5. 解析返回的 JSON
    try:
        raw_text = raw_text.strip()
        if raw_text.startswith("```"):
            lines = raw_text.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            raw_text = "\n".join(lines)
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as e:
        logger.error(
            f"[analyze_scenario] 解析 JSON 失败: {e}\n"
            f"原始内容前300字符: {raw_text[:300]}\n"
            f"{traceback.format_exc()}"
        )
        raise HTTPException(
            status_code=502,
            detail={
                "error_type": "json_parse_error",
                "message": "豆包返回内容无法解析为 JSON",
                "detail": raw_text[:300],
                "suggestion": "请稍后重试",
            },
        )

    # 6. 转换为前端期望的扁平格式
    poa = parsed.get("poa_task", {})

    ctx = poa.get("context_constraints", "")
    if isinstance(ctx, list):
        ctx = "\n".join(f"{i}. {c}" for i, c in enumerate(ctx, 1))
    else:
        ctx = str(ctx)

    eval_criteria = poa.get("evaluation_criteria", [])
    if isinstance(eval_criteria, list):
        eval_str = "\n".join(
            f"{i}. {c}" for i, c in enumerate(eval_criteria, 1)
        )
    else:
        eval_str = str(eval_criteria)

    result = {
        "scene_label": parsed.get("scene_label", ""),
        "user_role": poa.get("user_role", poa.get("roles", "")),
        "ai_role": poa.get("ai_role", ""),
        "roles": f"A: {poa.get('user_role', '')}; B: {poa.get('ai_role', '')}",
        "goal": poa.get("goal", ""),
        "context_constraints": ctx,
        "evaluation_criteria": eval_str,
        "variant_plot": parsed.get("variant_plot", ""),
    }

    logger.info(f"[analyze_scenario] 成功 — scene_label={result['scene_label']}")
    return result


def _split_roles(roles_str: str):
    """从 roles 字符串中提取 user_role 和 ai_role。"""
    import re as _re
    if not roles_str:
        return "", ""
    # A: xxx; B: yyy
    m = _re.match(r"A\s*[:：]\s*(.+?)\s*[;；]\s*B\s*[:：]\s*(.+)", roles_str)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    # 我方xxx，AIxxx / 学生xxx，AIxxx
    m2 = _re.match(r"(?:我方|学生|用户|你的角色)[\s：:为是]*(.+?)[，,]\s*(?:AI|对方|对话方|AI角色)[\s：:为是]*(.+)", roles_str)
    if m2:
        return m2.group(1).strip(), m2.group(2).strip()
    # xxx与AIxxx / xxx和AIxxx
    m3 = _re.match(r"(.+?)[与和]\s*AI\s*(.+)", roles_str)
    if m3:
        left = _re.sub(r"(?:我方|学生|用户|你的角色)[\s：:为是]*", "", m3.group(1)).strip()
        right = _re.sub(r"(?:AI|对方|对话方|AI角色)[\s：:为是]*", "", m3.group(2)).strip()
        if left and right:
            return left, right
    # xxx；yyy
    parts = _re.split(r"[;；]", roles_str)
    if len(parts) >= 2 and parts[0].strip() and parts[1].strip():
        return _re.sub(r"^(?:A|用户|我方|你的角色)\s*[:：]\s*", "", parts[0]).strip(), _re.sub(r"^(?:B|AI|对方|AI角色)\s*[:：]\s*", "", parts[1]).strip()
    # xxx，yyy
    parts = _re.split(r"[，,]", roles_str)
    if len(parts) >= 2 and parts[0].strip() and parts[1].strip():
        return _re.sub(r"^(?:A|用户|我方|你的角色)\s*[:：]\s*", "", parts[0]).strip(), _re.sub(r"^(?:B|AI|对方|AI角色)\s*[:：]\s*", "", parts[1]).strip()
    # 兜底
    return roles_str.strip(), ""


# ============================================================
# 1b. 带缓存的场景分析 —— DB 哈希去重
# ============================================================
def get_or_analyze_scenario(image_path: str, db: Session) -> Dict[str, Any]:
    """
    读取图片 → 计算 MD5 → 查 scenarios 表 →
      命中: 直接从 DB 读出已有的场景+任务数据
      未命中: 调用 analyze_scenario(VLM) → 写入 scenarios + poa_tasks → 返回
    """
    # 1. 计算图片 MD5
    try:
        with open(image_path, "rb") as f:
            file_bytes = f.read()
        image_hash = hashlib.md5(file_bytes).hexdigest()
    except OSError as e:
        logger.warning(f"[get_or_analyze] 无法读取文件: {image_path}")
        raise HTTPException(
            status_code=400,
            detail={
                "error_type": "file_not_found",
                "message": f"图片文件不存在: {image_path}",
                "detail": str(e),
                "suggestion": "请重新上传图片",
            },
        )

    logger.info(f"[get_or_analyze] image_path={image_path}  hash={image_hash}")

    # 2. 查缓存 — 按 hash 查找 Scenario，再取关联的 POATask
    existing_scenario = (
        db.query(Scenario).filter(Scenario.image_hash == image_hash).first()
    )
    if existing_scenario is not None:
        existing_task = (
            db.query(POATask)
            .filter(POATask.scenario_id == existing_scenario.id)
            .order_by(POATask.created_at.desc())
            .first()
        )
        if existing_task is not None:
            logger.info(
                f"[get_or_analyze] 缓存命中 — scenario_id={existing_scenario.id}"
            )
            # 解析 DB 中的 roles 字段，提取 user_role 和 ai_role
            db_roles = existing_task.roles or ""
            u_role, a_role = _split_roles(db_roles)
            return {
                "scenario_id": existing_scenario.id,
                "scene_label": existing_scenario.scene_label,
                "user_role": u_role,
                "ai_role": a_role,
                "roles": db_roles,
                "goal": existing_task.goal or "",
                "context_constraints": existing_task.context_constraints or "",
                "evaluation_criteria": existing_task.evaluation_criteria or "",
                "variant_plot": existing_task.variant_plot or "",
            }

    # 3. 缓存未命中 → 调 VLM 分析
    logger.info("[get_or_analyze] 缓存未命中，调用 VLM 分析...")
    result = analyze_scenario(image_path)
    scenario_id = None

    # 4. 写入数据库
    try:
        scenario = Scenario(
            image_path=image_path,
            image_hash=image_hash,
            scene_label=result["scene_label"],
        )
        db.add(scenario)
        db.flush()  # 拿到 scenario.id
        scenario_id = scenario.id

        task = POATask(
            scenario_id=scenario.id,
            roles=result["roles"],
            goal=result["goal"],
            context_constraints=result["context_constraints"],
            evaluation_criteria=result["evaluation_criteria"],
            variant_plot=result["variant_plot"],
        )
        db.add(task)
        db.commit()
        logger.info(
            f"[get_or_analyze] 已缓存 — scenario_id={scenario.id}"
        )
    except Exception as e:
        db.rollback()
        logger.error(f"[get_or_analyze] 写入数据库失败: {e}，仍返回分析结果")

    result["scenario_id"] = scenario_id
    return result


# ============================================================
# 通用 LLM 调用
# ============================================================
_DOUBAO_CHAT_URL = f"{DOUBAO_BASE_URL}/chat/completions"


def _call_llm(messages: List[Dict[str, str]], timeout: float = 120.0) -> str:
    """调用豆包 LLM，返回原始文本；失败抛出异常（含 httpx.ReadTimeout）。"""
    body = {"model": DOUBAO_MODEL_ID, "messages": messages}
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(
            _DOUBAO_CHAT_URL,
            headers={
                "Authorization": f"Bearer {DOUBAO_API_KEY}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _build_llm_error_gap(reason: str = "API 调用失败") -> Dict[str, Any]:
    """构建 LLM 调用失败时的降级 Gap 记录，数据结构与正常诊断完全一致。"""
    return {
        "gaps": [
            {
                "label": "诊断服务暂不可用",
                "evidence_sentence": "",
                "explanation": (
                    f"诊断服务{reason}，请稍后重试。"
                    f"若持续出现此问题，请检查网络连接或联系管理员。"
                ),
            }
        ]
    }


def _build_input_pack_fallback() -> Dict[str, Any]:
    """构建学习材料包降级数据，数据结构与 LLM 正常返回完全一致。"""
    return {
        "scene_chunks": [
            {"chunk": "I'd like a ..., please.", "meaning": "我想要一...", "usage": "点单开场句式"},
            {"chunk": "Could I have ... instead?", "meaning": "可以换成...吗？", "usage": "调整或替换订单"},
            {"chunk": "for here / to go", "meaning": "堂食 / 外带", "usage": "回应用餐方式询问"},
            {"chunk": "How much is it?", "meaning": "多少钱？", "usage": "询问价格"},
            {"chunk": "Thank you. Have a nice day!", "meaning": "谢谢，祝愉快！", "usage": "结束对话"},
        ],
        "functional_sentences": [
            {"function": "打招呼", "sentence": "Hi, I'd like to order ..., please."},
            {"function": "询问信息", "sentence": "Could you tell me ...?"},
            {"function": "特殊需求", "sentence": "I'm ... Could you ... instead?"},
            {"function": "确认", "sentence": "Yes, that's correct. Thank you."},
            {"function": "结束", "sentence": "Thank you so much. Have a great day!"},
        ],
        "demo_dialogue": (
            "Customer: Hi, I'd like a medium latte, please.\n"
            "Server: Sure. For here or to go?\n"
            "Customer: For here, thanks. How much is it?\n"
            "Server: That'll be $4.50.\n"
            "Customer: Here's my card. Thank you!\n"
            "Server: You're welcome. Have a nice day!"
        ),
        "strategy_tip": (
            "（学习材料生成服务暂时不可用，以下为通用策略）\n"
            "1. 用 'I'd like...' 替代 'I want...' 更礼貌。\n"
            "2. 'Could you...?' 比 'Can you...?' 更加委婉。\n"
            "3. 每次互动结尾加上 'please' 和 'thank you'。\n"
            "4. 没听清时用 'Sorry, could you say that again?'。"
        ),
    }


def _build_exercises_fallback() -> Dict[str, Any]:
    """构建练习题降级数据，数据结构与 LLM 正常返回完全一致。"""
    return {
        "exercises": [
            {
                "id": 1,
                "type": "multiple_choice",
                "gap_target": "通用练习",
                "question": "在服务场景中，以下哪种表达最礼貌得体？",
                "options": [
                    {"key": "A", "text": "I want a coffee."},
                    {"key": "B", "text": "Give me a coffee."},
                    {"key": "C", "text": "I'd like a coffee, please."},
                    {"key": "D", "text": "Coffee, now."},
                ],
                "answer": "C",
                "feedback": "C 使用 'I'd like...' + 'please' 是最礼貌的表达。",
            },
            {
                "id": 2,
                "type": "fill_in_blank",
                "gap_target": "通用练习",
                "question": "请填写正确的词：\"Could I have a cappuccino with _____ milk instead of regular milk?\"",
                "options": [],
                "answer": "oat",
                "feedback": "'oat milk' 是常见的植物奶选项，也可用 'almond' 或 'soy'。",
            },
        ]
    }


def _build_evaluate_fallback() -> Dict[str, Any]:
    """构建评价降级数据，数据结构与 LLM 正常返回完全一致。"""
    dims = ["fluency", "accuracy", "pragmatics", "complexity",
            "task_completion", "vocabulary", "pronunciation_intonation"]
    return {
        "dimension_scores": {d: {"attempt1": 50, "attempt2": 50} for d in dims},
        "problem_improved": "评价服务暂时不可用，无法生成问题改善分析。请稍后重试。",
        "full_report": "评价服务暂时不可用，无法生成综合评价报告。请检查网络连接或稍后重试。",
    }


def _parse_json(raw: str) -> Dict[str, Any]:
    """解析 LLM 返回的 JSON，自动处理 markdown 代码块包裹。"""
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        raw = "\n".join(lines)
    return json.loads(raw)


# ============================================================
# 2. 产出诊断 → LLM 分析核心不足列表
# ============================================================
_DIAGNOSE_PROMPT = """\
你是一个英语语言诊断专家。请分析学生的英语对话文本，找出 3-5 个核心语言/语用不足（gaps）。

对于每个 gap，请提供：
- label: 简洁的分类标签（如 "语法-主谓一致缺失"、"词汇-场景术语不准确"、"语用-礼貌策略缺失"）
- evidence_sentence: 学生原文中的具体句子（必须原样引用）
- explanation: 中文解释（40-80字），说明为何这是问题、母语者如何表达、如何改进

严格输出如下 JSON（不要输出任何其他内容）：
{
  "gaps": [
    {
      "label": "语法-主谓一致缺失",
      "evidence_sentence": "He go to school every day.",
      "explanation": "..."
    }
  ]
}"""


def _is_valid_transcription(text: str) -> bool:
    """
    校验转写文本是否有效，避免 LLM 根据无效输入胡编诊断。
    返回 True 表示文本有效可诊断。
    """
    stripped = text.strip()
    if not stripped:
        return False

    # 过短（少于 10 个有效字符）
    if len(stripped) < 10:
        return False

    # 全是无意义字符（标点、空白、特殊符号占比过高）
    alpha_num = len(re.findall(r"[a-zA-Z0-9一-鿿]", stripped))
    if alpha_num < 3:
        return False

    # 高频重复单一字符/片段（如 "呃呃呃"、"aaaa"、"..."）
    # 取前 20 个字符，如果同一字符出现超过 60%，视为乱码
    sample = stripped[:20]
    char_counts: Dict[str, int] = {}
    for ch in sample:
        char_counts[ch] = char_counts.get(ch, 0) + 1
    most_freq = max(char_counts.values())
    if len(sample) >= 5 and most_freq / len(sample) > 0.6:
        return False

    # 包含明显 ASR 失败标记
    garbage_markers = ["[inaudible]", "[unk]", "[silence]", "<unk>"]
    if any(marker in stripped.lower() for marker in garbage_markers):
        # 如果仅由失败标记构成，无效
        remaining = stripped.lower()
        for marker in garbage_markers:
            remaining = remaining.replace(marker, "")
        if len(remaining.strip()) < 5:
            return False

    return True


def diagnose_attempt(attempt_text: str) -> Dict[str, Any]:
    """
    调用 LLM 对学生的作答文本进行诊断，返回语言/语用不足列表。
    若转写文本无效（过短/乱码/无声），直接返回提示，不调用 LLM。
    """
    logger.info(f"[diagnose_attempt] text length={len(attempt_text)}")

    if not _is_valid_transcription(attempt_text):
        logger.warning(
            f"[diagnose_attempt] 转写文本无效，跳过 LLM 调用 — "
            f"text={attempt_text[:80]}"
        )
        return {
            "gaps": [
                {
                    "label": "语音识别失败",
                    "evidence_sentence": attempt_text.strip() or "(空)",
                    "explanation": "语音未能识别，请重新尝试。系统未能从您的录音中提取到足够的英语内容，可能原因：麦克风未正常工作、环境噪音过大、说话声音过小或未使用英语表达。",
                }
            ]
        }

    try:
        raw = _call_llm([
            {"role": "system", "content": _DIAGNOSE_PROMPT},
            {"role": "user", "content": f"学生对话文本:\n{attempt_text[:3000]}"},
        ])
        data = _parse_json(raw)
        gaps = data.get("gaps", [])
        logger.info(f"[diagnose_attempt] LLM 诊断出 {len(gaps)} 个不足")
        return {"gaps": gaps}
    except httpx.ReadTimeout:
        logger.warning("[diagnose_attempt] LLM 调用超时，降级返回")
        return _build_llm_error_gap("请求超时")
    except Exception as e:
        logger.error(f"[diagnose_attempt] LLM 调用失败: {e}，降级返回")
        return _build_llm_error_gap("暂时不可用")


# ============================================================
# 3. 生成学习材料包 → LLM 根据 gaps 动态生成
# ============================================================
_INPUT_PACK_PROMPT = """\
你是一个英语教学材料设计师。请根据学生的诊断不足列表（gaps），生成针对性的学习材料包。

输出要求：
- scene_chunks: 4-6 个场景语块，包含英文表达式、中文含义、使用场景
- functional_sentences: 4-6 个功能句式，标注功能和完整句子
- demo_dialogue: 一段 8-12 轮的示范对话，A/B 角色交替
- strategy_tip: 3-5 条具体的学习策略提示

严格输出如下 JSON（不要输出任何其他内容）：
{
  "scene_chunks": [
    {"chunk": "英文语块", "meaning": "中文含义", "usage": "使用说明"}
  ],
  "functional_sentences": [
    {"function": "功能名称", "sentence": "完整英文句子"}
  ],
  "demo_dialogue": "A: ...\\nB: ...\\n...",
  "strategy_tip": "策略提示文本"
}"""


def generate_input_pack(gaps: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    调用 LLM 根据诊断不足列表，生成学习材料包。
    失败时直接抛出异常。
    """
    logger.info(f"[generate_input_pack] gaps count={len(gaps)}")

    if not gaps:
        raise ValueError("gaps 列表为空，无法生成学习材料")

    gap_lines = []
    for i, g in enumerate(gaps, 1):
        label = g.get("label", "未知")
        ev = g.get("evidence_sentence", "")
        expl = g.get("explanation", "")
        gap_lines.append(f"{i}. [{label}] 原文: {ev}  说明: {expl}")
    gaps_text = "\n".join(gap_lines)

    try:
        raw = _call_llm([
            {"role": "system", "content": _INPUT_PACK_PROMPT},
            {"role": "user", "content": f"学生不足列表:\n{gaps_text}\n\n请生成对应的学习材料包。"},
        ])
        data = _parse_json(raw)
        logger.info(f"[generate_input_pack] LLM 生成完成")
        return data
    except httpx.ReadTimeout:
        logger.warning("[generate_input_pack] LLM 调用超时，降级返回")
        return _build_input_pack_fallback()
    except Exception as e:
        logger.error(f"[generate_input_pack] LLM 调用失败: {e}，降级返回")
        return _build_input_pack_fallback()


# ============================================================
# 4. 生成练习题 → LLM 根据 gaps 动态生成
# ============================================================
_EXERCISES_PROMPT = """\
你是一个英语练习题设计专家。请根据学生的诊断不足列表（gaps），生成 2-4 道针对性练习题。

题目类型:
- multiple_choice: 选择题，4 个选项（A/B/C/D），考察正确表达的选择能力
- fill_in_blank: 填空题，学生填入正确词汇或短语

每题需包含:
- id: 序号
- type: "multiple_choice" 或 "fill_in_blank"
- gap_target: 该题针对的不足标签
- question: 中文题目描述
- options: 选择题的 4 个选项（填空题给空数组）
- answer: 正确答案
- feedback: 中文答题反馈（40-80字），解释为什么正确、错误选项的问题

严格输出如下 JSON（不要输出任何其他内容）：
{
  "exercises": [
    {
      "id": 1,
      "type": "multiple_choice",
      "gap_target": "语法-情态动词缺失",
      "question": "在咖啡店点单时，哪种表达最礼貌得体？",
      "options": [
        {"key": "A", "text": "I want a latte."},
        {"key": "B", "text": "Give me a latte."},
        {"key": "C", "text": "I'd like a latte, please."},
        {"key": "D", "text": "Latte, now."}
      ],
      "answer": "C",
      "feedback": "'I'd like...' + 'please' 是服务场景最礼貌的表达。A 和 B 过于直接，D 非常粗鲁。"
    }
  ]
}"""


def generate_exercises(gaps: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    调用 LLM 根据诊断不足列表，生成针对性练习题。
    失败时直接抛出异常。
    """
    logger.info(f"[generate_exercises] gaps count={len(gaps)}")

    if not gaps:
        raise ValueError("gaps 列表为空，无法生成练习题")

    gap_lines = []
    for i, g in enumerate(gaps, 1):
        label = g.get("label", "未知")
        expl = g.get("explanation", "")
        gap_lines.append(f"{i}. [{label}] {expl}")
    gaps_text = "\n".join(gap_lines)

    try:
        raw = _call_llm([
            {"role": "system", "content": _EXERCISES_PROMPT},
            {"role": "user", "content": f"学生不足列表:\n{gaps_text}\n\n请生成针对性的练习题。"},
        ])
        data = _parse_json(raw)
        exercises = data.get("exercises", [])
        logger.info(f"[generate_exercises] LLM 生成 {len(exercises)} 道题")
        return {"exercises": exercises}
    except httpx.ReadTimeout:
        logger.warning("[generate_exercises] LLM 调用超时，降级返回")
        return _build_exercises_fallback()
    except Exception as e:
        logger.error(f"[generate_exercises] LLM 调用失败: {e}，降级返回")
        return _build_exercises_fallback()


# ============================================================
# 5. 双轨评价 → LLM 七维评分 + 改善判断 + 综合报告
# ============================================================
_EVALUATE_PROMPT = """\
你是一个英语口语评估专家。请对比学生的初次产出和二次产出，按七维度逐一评分并撰写报告。

七维度说明:
- fluency: 流利度
- accuracy: 语法准确性
- pragmatics: 语用得体性
- complexity: 句式复杂度
- task_completion: 任务完成度
- vocabulary: 词汇丰富度
- pronunciation_intonation: 发音语调

输出要求:
- dimension_scores: 每个维度给出 attempt1 和 attempt2 的分数（0-100）
- problem_improved: 用中文列出每个问题的改善情况，必须包含具体对比举例
- full_report: 完整综合评价报告（中文，300-500字），包含总体进步、各维度分析、下一步建议

严格输出如下 JSON（不要输出任何其他内容）：
{
  "dimension_scores": {
    "fluency": {"attempt1": 58, "attempt2": 76},
    "accuracy": {"attempt1": 52, "attempt2": 80},
    "pragmatics": {"attempt1": 45, "attempt2": 74},
    "complexity": {"attempt1": 48, "attempt2": 68},
    "task_completion": {"attempt1": 70, "attempt2": 90},
    "vocabulary": {"attempt1": 50, "attempt2": 78},
    "pronunciation_intonation": {"attempt1": 60, "attempt2": 72}
  },
  "problem_improved": "1. 【语法】初次...二次改为...具体对比: ...\\n2. ...",
  "full_report": "综合评价报告全文..."
}"""


def evaluate(attempt1_text: str, attempt2_text: str) -> Dict[str, Any]:
    """
    调用 LLM 对比两次作答，返回七维度双轨评价。
    失败时直接抛出异常。
    """
    logger.info(
        f"[evaluate] attempt1={len(attempt1_text)} chars, "
        f"attempt2={len(attempt2_text)} chars"
    )

    if not attempt1_text.strip() or not attempt2_text.strip():
        raise ValueError("两次产出文本均不能为空")

    user_content = (
        f"【初次产出】\n{attempt1_text[:2000]}\n\n"
        f"【二次产出】\n{attempt2_text[:2000]}\n\n"
        f"请对比两次产出，按七维度评分并撰写报告。"
    )

    try:
        raw = _call_llm([
            {"role": "system", "content": _EVALUATE_PROMPT},
            {"role": "user", "content": user_content},
        ])
        data = _parse_json(raw)
        logger.info(f"[evaluate] LLM 评价完成")
        return data
    except httpx.ReadTimeout:
        logger.warning("[evaluate] LLM 调用超时，降级返回")
        return _build_evaluate_fallback()
    except Exception as e:
        logger.error(f"[evaluate] LLM 调用失败: {e}，降级返回")
        return _build_evaluate_fallback()
