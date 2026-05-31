"""
促成学习服务 —— 调用豆包 LLM 根据诊断不足动态生成输入材料包。
"""
import json
import logging
from typing import Any, Dict, List

import httpx

from config import DOUBAO_API_KEY, DOUBAO_BASE_URL, DOUBAO_MODEL_ID

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("facilitate_service")

DOUBAO_CHAT_URL = f"{DOUBAO_BASE_URL}/chat/completions"

_INPUT_PACK_PROMPT = """\
你是一个英语教学材料设计师。请根据学生的诊断不足列表（gaps），生成针对性的学习材料包。

输出要求：
- scene_chunks: 4-6 个场景语块，包含英文表达式(chunk)、中文含义(meaning)、使用场景说明(usage)
- functional_sentences: 4-6 个功能句式，标注功能名称(function)和完整英文句子(sentence)
- demo_dialogue: 一段 8-12 轮的示范对话，A/B 角色交替，用 \\n 换行
- strategy_tip: 3-5 条具体的学习策略提示文本

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

# ---- 超时降级 Mock 数据 ----
_MOCK_INPUT_PACK: Dict[str, Any] = {
    "scene_chunks": [
        {"chunk": "I'd like a ..., please.", "meaning": "我想要一...", "usage": "礼貌点单开场句式"},
        {"chunk": "Could I have ... instead?", "meaning": "可以换成...吗？", "usage": "替换或调整订单"},
        {"chunk": "for here / to go", "meaning": "堂食 / 外带", "usage": "回应服务员的用餐方式询问"},
        {"chunk": "How much is it?", "meaning": "多少钱？", "usage": "询问价格"},
        {"chunk": "Thank you. Have a nice day!", "meaning": "谢谢，祝你愉快！", "usage": "结束对话的礼貌用语"},
    ],
    "functional_sentences": [
        {"function": "打招呼 / 开启对话", "sentence": "Hi, I'd like to order ..., please."},
        {"function": "询问信息", "sentence": "Could you tell me ...?"},
        {"function": "说明特殊需求", "sentence": "I'm ... Could you ... instead?"},
        {"function": "确认信息", "sentence": "Yes, that's correct. Thank you."},
        {"function": "礼貌结束", "sentence": "Thank you so much. Have a great day!"},
    ],
    "demo_dialogue": (
        "Customer: Hi, I'd like a medium latte, please.\n"
        "Server: Sure. For here or to go?\n"
        "Customer: For here, thanks. How much is it?\n"
        "Server: That'll be $4.50.\n"
        "Customer: Here's my card. Thank you!\n"
        "Server: You're welcome. Have a nice day!\n"
        "Customer: Thanks, you too!"
    ),
    "strategy_tip": (
        "1. 用 'I'd like...' 替代 'I want...'，听起来更礼貌自然。\n"
        "2. 'Could you...?' 比 'Can you...?' 更加委婉礼貌。\n"
        "3. 每次互动结尾加上 'please' 和 'thank you'。\n"
        "4. 没听清时用 'Sorry, could you say that again?' 而非 'What?'。"
    ),
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


def generate_input_pack(gaps: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    调用 LLM 根据诊断 gaps 动态生成输入材料包。
    超时时降级返回 Mock 数据；其他错误直接抛出异常。
    """
    logger.info(f"[facilitate] generate_input_pack — gaps count={len(gaps) if gaps else 0}")

    if not gaps:
        raise ValueError("gaps 列表为空，无法生成学习材料")

    gap_lines = []
    for i, g in enumerate(gaps, 1):
        label = g.get("label", "未知")
        ev = g.get("evidence_sentence", "")
        expl = g.get("explanation", "")
        gap_lines.append(f"{i}. [{label}] 原文: {ev}  说明: {expl}")
    gaps_text = "\n".join(gap_lines)

    body = {
        "model": DOUBAO_MODEL_ID,
        "messages": [
            {"role": "system", "content": _INPUT_PACK_PROMPT},
            {"role": "user", "content": f"学生不足列表:\n{gaps_text}\n\n请生成对应的学习材料包。"},
        ],
    }

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
            resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"]
        data = _parse_json(raw)
        logger.info(f"[facilitate] LLM 生成学习材料包完成")
        return data
    except httpx.ReadTimeout:
        logger.warning("[facilitate] generate_input_pack 调用超时，降级使用 Mock")
        return dict(_MOCK_INPUT_PACK)
