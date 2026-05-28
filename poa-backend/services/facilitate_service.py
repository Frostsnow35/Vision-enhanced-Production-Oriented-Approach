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
    {"chunk": "a latte / a cappuccino / an americano", "meaning": "拿铁 / 卡布奇诺 / 美式咖啡", "usage": "点单时指定咖啡品类"},
    {"chunk": "oat milk / almond milk / soy milk", "meaning": "燕麦奶 / 杏仁奶 / 豆奶", "usage": "说明乳制品替代需求"},
    {"chunk": "for here / to go", "meaning": "堂食 / 外带", "usage": "回应咖啡师的堂食/外带询问"},
    {"chunk": "the Wi-Fi password", "meaning": "Wi-Fi 密码", "usage": "询问店内无线网络密码"},
    {"chunk": "the receipt / the bill / the check", "meaning": "收据 / 账单", "usage": "请求结账或索取收据"},
    {"chunk": "a pastry / a muffin / a cookie", "meaning": "糕点 / 松饼 / 饼干", "usage": "搭配咖啡的点心选择"},
]

# ---- 预设功能句式 ----
_MOCK_FUNCTIONAL_SENTENCES = [
    {"function": "点单表达", "sentence": "I'd like a ..., please."},
    {"function": "替换需求", "sentence": "Could I have that with ... instead?"},
    {"function": "询问信息", "sentence": "Could you tell me the Wi-Fi password?"},
    {"function": "请求单据", "sentence": "Can I have the receipt, please?"},
    {"function": "委婉请求", "sentence": "Would it be possible to get ... ?"},
    {"function": "请求重复", "sentence": "Sorry, could you say that again?"},
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
