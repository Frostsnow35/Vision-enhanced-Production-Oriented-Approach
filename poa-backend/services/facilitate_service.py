"""
促成学习服务 —— 根据诊断不足生成输入材料包和练习题。
当前为 Mock 实现，后续可接入 LLM 根据真实 gaps 动态生成。
"""
import logging
from typing import Any, Dict, List

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("facilitate_service")

# ---- 预设场景词块 ----
_MOCK_SCENE_CHUNKS = [
    "a latte / a cappuccino / an americano",
    "oat milk / almond milk / soy milk",
    "for here / to go",
    "the Wi-Fi password",
    "the receipt / the bill / the check",
    "a pastry / a muffin / a cookie",
]

# ---- 预设功能句式 ----
_MOCK_FUNCTIONAL_SENTENCES = [
    "I'd like a ..., please.",
    "Could I have that with ... instead?",
    "Could you tell me the Wi-Fi password?",
    "Can I have the receipt, please?",
    "Would it be possible to get ... ?",
    "Sorry, could you say that again?",
]

# ---- 预设示范对话 ----
_MOCK_DEMO_DIALOGUE = (
    "Customer: Hi, I'd like a medium latte, please.\n"
    "Barista: Sure, what size would you like?\n"
    "Customer: Medium, please. And could I get the Wi-Fi password?\n"
    "Barista: Of course, it's 'coffee123'.\n"
    "Customer: Great, thanks. How much is that?\n"
    "Barista: That'll be $4.50.\n"
    "Customer: Here's my card. And could I have the receipt?\n"
    "Barista: Sure, here you go. Have a nice day!\n"
    "Customer: Thank you, you too!"
)

# ---- 预设策略提示 ----
_MOCK_STRATEGY_TIP = (
    "【礼貌请求策略】\n"
    "1. 用 'I'd like...' 替代 'I want...'，听起来更礼貌自然；\n"
    "2. 使用 'Could you...?' 或 'Would it be possible...?' 进行委婉请求；\n"
    "3. 每次互动结尾加上 'please' 和 'thank you'；\n"
    "4. 如果没听清，用 'Sorry, could you say that again?' 而不是 'What?'。"
)


def generate_input_pack(gaps: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    根据诊断 gaps 列表，生成输入材料包。
    当前阶段返回固定 Mock 数据（忽略 gaps 内容）；
    后续可在此接入 LLM，根据实际 gaps 动态生成更精准的材料。
    """
    logger.info(f"[facilitate] generate_input_pack called — gaps count={len(gaps) if gaps else 0}")

    return {
        "scene_chunks": _MOCK_SCENE_CHUNKS,
        "functional_sentences": _MOCK_FUNCTIONAL_SENTENCES,
        "demo_dialogue": _MOCK_DEMO_DIALOGUE,
        "strategy_tip": _MOCK_STRATEGY_TIP,
    }
