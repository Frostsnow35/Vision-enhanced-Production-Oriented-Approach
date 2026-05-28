"""
AI 服务 —— analyze_scenario 已接入豆包视觉模型 + DB 哈希缓存，
失败时直接抛 HTTPException（无 Mock 降级），
其余函数（diagnose / input_pack / exercises / evaluate）仍为 Mock。
"""
import base64
import hashlib
import json
import logging
import os
import time
import traceback
from typing import Any, Dict, List

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from config import DOUBAO_API_KEY, DOUBAO_BASE_URL, ARK_MODEL_ID
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
    "roles": "你的角色和AI角色",
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
        "roles": poa.get("roles", ""),
        "goal": poa.get("goal", ""),
        "context_constraints": ctx,
        "evaluation_criteria": eval_str,
        "variant_plot": parsed.get("variant_plot", ""),
    }

    logger.info(f"[analyze_scenario] 成功 — scene_label={result['scene_label']}")
    return result


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
            return {
                "scene_label": existing_scenario.scene_label,
                "roles": existing_task.roles or "",
                "goal": existing_task.goal or "",
                "context_constraints": existing_task.context_constraints or "",
                "evaluation_criteria": existing_task.evaluation_criteria or "",
                "variant_plot": existing_task.variant_plot or "",
            }

    # 3. 缓存未命中 → 调 VLM 分析
    logger.info("[get_or_analyze] 缓存未命中，调用 VLM 分析...")
    result = analyze_scenario(image_path)

    # 4. 写入数据库
    try:
        scenario = Scenario(
            image_path=image_path,
            image_hash=image_hash,
            scene_label=result["scene_label"],
        )
        db.add(scenario)
        db.flush()  # 拿到 scenario.id

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

    return result


# ============================================================
# 2. 产出诊断 → 返回核心不足列表
# ============================================================
def diagnose_attempt(attempt_text: str) -> Dict[str, Any]:
    """
    对学生的一次作答文本进行诊断，返回发现的语言/语用不足（Gap 格式）。
    真实实现应调用 LLM 进行多维度分析。
    """
    logger.info(
        f"[Mock AI] diagnose_attempt called — "
        f"text={attempt_text[:80]}..."
    )

    return {
        "gaps": [
            {
                "label": "语法-情态动词缺失",
                "evidence_sentence": "I want a large latte.",
                "explanation": (
                    "'I want...' 在服务场景中听起来生硬且略显粗鲁，"
                    "英语母语者通常使用 'I'd like...' 或 'Could I have...' 表达请求。"
                    "建议改为 'I'd like a large latte, please.' 或 "
                    "'Could I get a large latte?'"
                ),
            },
            {
                "label": "词汇-咖啡术语不准确",
                "evidence_sentence": "Give me a big cup of coffee with no milk.",
                "explanation": (
                    "'big cup' 不是咖啡店的标准表达，使用 'large' 更准确；"
                    "'coffee with no milk' 无法区分是美式（americano）"
                    "还是滴滤咖啡（drip coffee），咖啡师会困惑；"
                    "如果乳糖不耐受，应明确说 'oat milk' 或 'almond milk' "
                    "而不是 'no milk'（这会让人误以为要喝黑咖啡）。"
                ),
            },
            {
                "label": "语用-缺少互动确认",
                "evidence_sentence": "(咖啡师问 'For here or to go?' 时只回答 'Here.')",
                "explanation": (
                    "简短回答 'Here.' 在语法上没有问题，但在服务场景中过于突兀。"
                    "建议完整句式 'For here, please.' 或 'I'll have it here, thank you.'，"
                    "加上 'please' 和 'thank you' 体现礼貌。"
                ),
            },
            {
                "label": "发音/语调-疑问句升调缺失",
                "evidence_sentence": "How much is it.",
                "explanation": (
                    "疑问句句末应该用升调（rising intonation）而非降调。"
                    "降调的 'How much is it.' 听起来像陈述句或显得不耐烦。"
                    "建议语调在句末上扬，同时可以加 'Excuse me' 开头更礼貌："
                    "'Excuse me, how much is it?' ↗"
                ),
            },
        ]
    }


# ============================================================
# 3. 生成学习材料包 → 对应不足的输入材料
# ============================================================
def generate_input_pack(gaps: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    根据诊断出的不足列表，生成针对性的学习材料包。
    包含：场景语块、功能句、示范对话、策略提示。
    """
    logger.info(f"[Mock AI] generate_input_pack called — gaps count={len(gaps)}")

    return {
        "scene_chunks": [
            {
                "chunk": "I'd like a ...",
                "meaning": "我想要一杯...",
                "usage": "点单开头句式，后接咖啡品类和大小",
            },
            {
                "chunk": "with oat milk / almond milk",
                "meaning": "换成燕麦奶 / 杏仁奶",
                "usage": "说明乳制品替代需求",
            },
            {
                "chunk": "for here / to go",
                "meaning": "堂食 / 带走",
                "usage": "回应咖啡师的堂食/外带询问",
            },
            {
                "chunk": "Can I have the check?",
                "meaning": "我可以买单吗？",
                "usage": "请求结账的礼貌表达",
            },
            {
                "chunk": "Keep the change.",
                "meaning": "不用找了。",
                "usage": "支付时的常用表达（给小费场景）",
            },
        ],
        "functional_sentences": [
            {
                "function": "打招呼 & 开启点单",
                "sentence": "Hi, I'd like to order a large iced latte with oat milk, please.",
            },
            {
                "function": "询问菜单/推荐",
                "sentence": "What would you recommend for someone who likes something not too sweet?",
            },
            {
                "function": "说明饮食限制",
                "sentence": "I'm lactose intolerant, so could you use oat milk instead?",
            },
            {
                "function": "确认 & 感谢",
                "sentence": "Yes, that's correct. Thank you so much!",
            },
            {
                "function": "支付",
                "sentence": "How much is it? ... Here's my card. Keep the change!",
            },
        ],
        "demo_dialogue": (
            "A (Barista): Hi there! What can I get for you today?\n"
            "B (Customer): Hi! I'd like a medium iced latte, please.\n"
            "A: Sure. For here or to go?\n"
            "B: For here, thanks.\n"
            "A: Anything else?\n"
            "B: Actually, could I have that with oat milk? I'm lactose intolerant.\n"
            "A: Of course! We can do that. That'll be $5.50.\n"
            "B: Great, here's my card.\n"
            "A: Thanks. Your order will be ready in just a few minutes.\n"
            "B: Thank you so much!"
        ),
        "strategy_tip": (
            "【咖啡店点单策略】\n"
            "1. 语序公式: (问候) + I'd like + 大小 + 温度(iced/hot) + 品类 + 定制 + please\n"
            "   示例: Hi, I'd like a small hot cappuccino with almond milk, please.\n"
            "2. 如果没听清，不要猜——用 'Sorry, could you say that again?' 请求重复；\n"
            "3. 高峰期尽量一次说完需求（大小+品类+定制），减少咖啡师的追问次数；\n"
            "4. 即使说错了也不要紧张，用 'Oh sorry, I meant...' 自然修正即可。"
        ),
    }


# ============================================================
# 4. 生成练习题 → 选择题 / 填空题，带答案和反馈
# ============================================================
def generate_exercises(gaps: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    根据诊断出的不足列表，生成 2~3 道针对性练习题。
    包含：题目、选项、正确答案、详细反馈。
    """
    logger.info(f"[Mock AI] generate_exercises called — gaps count={len(gaps)}")

    return {
        "exercises": [
            {
                "id": 1,
                "type": "multiple_choice",
                "gap_target": "语法-情态动词缺失",
                "question": (
                    "你在咖啡店想点一杯大杯拿铁，以下哪种表达最礼貌得体？"
                ),
                "options": [
                    {"key": "A", "text": "I want a large latte."},
                    {"key": "B", "text": "Give me a large latte."},
                    {"key": "C", "text": "I'd like a large latte, please."},
                    {"key": "D", "text": "Large latte, now."},
                ],
                "answer": "C",
                "feedback": (
                    "A 和 B 都过于直接，D 非常粗鲁。C 使用 'I'd like...' + 'please'，"
                    "是服务场景中最自然礼貌的表达方式。记住公式：I'd like + 大小 + 品类 + please。"
                ),
            },
            {
                "id": 2,
                "type": "fill_in_blank",
                "gap_target": "词汇-咖啡术语不准确",
                "question": (
                    "你乳糖不耐受，想让咖啡师把牛奶换成燕麦奶。请填写空格：\n"
                    "\"Could I have a cappuccino with _____ _____ instead of regular milk?\""
                ),
                "options": [],
                "answer": "oat milk",
                "feedback": (
                    "'oat milk'（燕麦奶）是咖啡店最常见的植物奶选项之一。"
                    "其他可接受的答案：'almond milk'（杏仁奶）、'soy milk'（豆奶）。"
                    "完整的礼貌表达：'Could I have a cappuccino with oat milk instead of regular milk, please?'"
                ),
            },
            {
                "id": 3,
                "type": "multiple_choice",
                "gap_target": "语用-缺少互动确认",
                "question": (
                    "咖啡师问 'For here or to go?' 以下哪种回应最自然？"
                ),
                "options": [
                    {"key": "A", "text": "Here."},
                    {"key": "B", "text": "For here, please."},
                    {"key": "C", "text": "I want to stay here."},
                    {"key": "D", "text": "Doesn't matter."},
                ],
                "answer": "B",
                "feedback": (
                    "A 太简短显得冷淡；C 表达不自然（'stay here' 多指留在某个地方不走）；"
                    "D 显得不关心。B 是最得体的回应：重复关键词 'for here' 表示确认，"
                    "加上 'please' 保持礼貌。也可以用 'To go, please.' 表示带走。"
                ),
            },
        ]
    }


# ============================================================
# 5. 双轨评价 → 七维评分 + 改善判断 + 综合报告
# ============================================================
def evaluate(attempt1_text: str, attempt2_text: str) -> Dict[str, Any]:
    """
    对比改进前（attempt1）与改进后（attempt2）的两次作答，
    返回七维度双轨评分、问题改善判断和综合评价报告。
    """
    logger.info(
        f"[Mock AI] evaluate called — "
        f"attempt1={attempt1_text[:60]}... / "
        f"attempt2={attempt2_text[:60]}..."
    )

    return {
        "dimension_scores": {
            "fluency":        {"attempt1": 58, "attempt2": 76},
            "accuracy":       {"attempt1": 52, "attempt2": 80},
            "pragmatics":     {"attempt1": 45, "attempt2": 74},
            "complexity":     {"attempt1": 48, "attempt2": 68},
            "task_completion": {"attempt1": 70, "attempt2": 90},
            "vocabulary":     {"attempt1": 50, "attempt2": 78},
            "pronunciation_intonation": {"attempt1": 60, "attempt2": 72},
        },
        "problem_improved": (
            "1. 【语法-情态动词缺失】已修正："
            "第二次作答将 'I want' 替换为 'I'd like' 和 'Could I have'，礼貌度显著提升；\n"
            "2. 【词汇-咖啡术语不准确】已修正："
            "第二次正确使用了 'iced latte'、'oat milk' 等专业术语；\n"
            "3. 【语用-缺少互动确认】部分改善："
            "第二次对 'For here or to go?' 回应为 'For here, please.' 已基本达标，"
            "但金额确认环节仍可补充 'thank you'；\n"
            "4. 【发音/语调-疑问句升调缺失】有所改善，但连读和弱读仍需继续练习。"
        ),
        "full_report": (
            "═══════════ 双轨评价报告 ═══════════\n\n"
            "【总体进步】第二次作答在全部七个维度上均有明显进步，"
            "其中语用维度提升最大（+29分），说明学生在礼貌策略和互动确认方面有显著学习效果。\n\n"
            "【语法准确性 → +28分】\n"
            "第一次：存在明显的情态动词缺失和祈使句过度使用问题。\n"
            "第二次：正确使用 'I'd like'、'Could I' 等委婉表达，主谓一致无误。\n"
            "改进亮点：从命令式转向请求式的转变非常自然。\n\n"
            "【词汇丰富度 → +28分】\n"
            "第一次：使用 'big cup'、'no milk' 等泛化表达。\n"
            "第二次：准确使用 'large iced latte with oat milk'，"
            "并主动使用 'lactose intolerant' 解释特殊需求。\n"
            "改进亮点：学会了咖啡店场景的核心术语。\n\n"
            "【语用得体性 → +29分】\n"
            "第一次：整体缺乏礼貌标记（please/thank you），互动生硬。\n"
            "第二次：使用了完整的礼貌句式，对咖啡师提问做出合理回应，"
            "并在结尾表达感谢。\n"
            "改进亮点：从 'Here.' 到 'For here, please. Thank you!' "
            "体现了英语服务场景的礼仪规范。\n\n"
            "【流利度 → +18分】\n"
            "第二次的回答更连贯，停顿减少，但仍有提升空间（偶尔犹豫）。\n\n"
            "【复杂度 → +20分】\n"
            "第二次尝试使用了复合句（'Actually, could I have...because I'm...'），"
            "虽然偶尔有卡顿，但显示了扩展句式的能力。\n\n"
            "【下一步建议】\n"
            "1. 练习在高峰期语境下的快速反应，尝试不看稿进行角色扮演；\n"
            "2. 针对 '变体B（做错饮品需要退换）' 进行专项练习，"
            "学习如何礼貌地指出问题（'Excuse me, I think there might be a mistake...'）；\n"
            "3. 继续打磨发音，特别是 iced (/'aɪst/) 的尾音不要吞掉。"
        ),
    }
