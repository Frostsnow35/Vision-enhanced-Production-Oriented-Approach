import json
import uuid
from typing import List, Dict, Any, Optional
from config.settings import settings

class MockAIService:
    def analyze_image(self, image_url: str) -> Dict[str, Any]:
        mock_scene_info = {
            "location": "coffee_shop",
            "characters": ["customer", "barista"],
            "potential_tasks": ["ordering_coffee", "asking_for_recommendations", "paying_for_order"],
            "cultural_context": "western_coffee_culture"
        }
        return mock_scene_info

    def generate_poa_task(self, scene_info: Dict[str, Any]) -> Dict[str, Any]:
        mock_task = {
            "your_role": "顾客",
            "ai_role": "咖啡店服务员",
            "goal": "点一杯咖啡并询问今日推荐",
            "constraints": [
                "使用礼貌用语",
                "对话时间约30-60秒",
                "需要询问价格和制作时间",
                "英语交流"
            ],
            "evaluation_criteria": [
                "语用得体性：使用适当的礼貌用语",
                "功能达成：成功点单并获取所需信息",
                "话轮适配：自然衔接对话",
                "词汇多样性：使用丰富的表达方式",
                "语法准确性：句子结构正确"
            ],
            "new_plot_variant": "顾客想要尝试新品，询问服务员推荐并决定是否尝试"
        }
        return mock_task

    def transcribe_audio(self, audio_url: str) -> str:
        return "Could I have a latte please? How much does it cost?"

    def diagnose_performance(self, transcript: str, task: Dict[str, Any]) -> List[Dict[str, Any]]:
        mock_gaps = [
            {
                "id": str(uuid.uuid4()),
                "type": "语用得体性",
                "evidence": '使用了礼貌用语 "Could I have..."',
                "consequence": "表达得体，符合服务场景的交际规范",
                "target_improvement": "继续保持礼貌用语的使用"
            },
            {
                "id": str(uuid.uuid4()),
                "type": "词汇多样性",
                "evidence": '使用了 "latte" 等咖啡相关词汇',
                "consequence": "词汇表达较为准确",
                "target_improvement": "可以学习更多咖啡种类的英文表达"
            },
            {
                "id": str(uuid.uuid4()),
                "type": "话轮适配",
                "evidence": "对话简短直接",
                "consequence": "能够完成基本交际目标",
                "target_improvement": "可以适当扩展对话，增加交流感"
            }
        ]
        return mock_gaps

    def generate_input_pack(self, gaps: List[Dict[str, Any]]) -> Dict[str, Any]:
        mock_input_pack = {
            "vocabulary": [
                {"word": "Could I have...", "meaning": "我可以要...吗？（礼貌请求）"},
                {"word": "May I order...", "meaning": "我可以点...吗？（礼貌请求）"},
                {"word": "Latte", "meaning": "拿铁咖啡"},
                {"word": "Espresso", "meaning": "浓缩咖啡"},
                {"word": "Caramel macchiato", "meaning": "焦糖玛奇朵"},
                {"word": "Please", "meaning": "请（礼貌用语）"},
                {"word": "Thank you", "meaning": "谢谢"},
                {"word": "You're welcome", "meaning": "不客气"}
            ],
            "patterns": [
                "Could I have a [drink] please?",
                "May I order a [drink]?",
                "How much does the [drink] cost?",
                "Thank you very much!"
            ],
            "model_dialogue": [
                {"speaker": "Customer", "text": "Good morning! Could I have a latte please?"},
                {"speaker": "Barista", "text": "Certainly! That will be $4.50."},
                {"speaker": "Customer", "text": "Thank you! Could you make it hot?"},
                {"speaker": "Barista", "text": "Absolutely! It'll be ready in 3 minutes."},
                {"speaker": "Customer", "text": "Great, thank you very much!"}
            ],
            "strategies": [
                '使用 "Could I..." 或 "May I..." 开头的礼貌句式',
                '在请求后加上 "please"',
                '收到服务后记得说 "thank you"',
                "可以适当询问额外信息，如温度、配料等"
            ]
        }
        return mock_input_pack

    def generate_exercises(self, gaps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        mock_exercises = [
            {
                "id": str(uuid.uuid4()),
                "question": "选择最礼貌的点餐方式：",
                "options": [
                    "Give me a coffee.",
                    "I want a coffee.",
                    "Could I have a coffee please?",
                    "Coffee, now!"
                ],
                "correct_answer": 2,
                "explanation": '使用 "Could I have..." 是最礼貌的请求方式，加上 "please" 更加得体。'
            },
            {
                "id": str(uuid.uuid4()),
                "question": '服务员说 "That will be $4.50"，你应该如何回应？',
                "options": [
                    "OK.",
                    "Here you are. Thank you!",
                    "Give me the coffee first.",
                    "Too expensive."
                ],
                "correct_answer": 1,
                "explanation": "支付时应该表示感谢，'Here you are' 表示递钱，加上 'Thank you' 显得礼貌。"
            },
            {
                "id": str(uuid.uuid4()),
                "question": '当服务员问 "Would you like anything else?"，最合适的回答是：',
                "options": [
                    "No.",
                    "No, thank you.",
                    "Nope.",
                    "I'm good."
                ],
                "correct_answer": 1,
                "explanation": '"No, thank you." 是最礼貌的拒绝方式，即使不需要其他东西也要表示感谢。'
            }
        ]
        return mock_exercises

    def evaluate_performance(
        self, 
        attempt1_transcript: str, 
        attempt2_transcript: str,
        task: Dict[str, Any],
        gaps: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        mock_evaluation = {
            "seven_dimension_scores": [
                {"name": "发音", "attempt1": 65, "attempt2": 72},
                {"name": "语法", "attempt1": 70, "attempt2": 78},
                {"name": "词汇", "attempt1": 55, "attempt2": 70},
                {"name": "功能达成", "attempt1": 60, "attempt2": 85},
                {"name": "语用得体", "attempt1": 45, "attempt2": 75},
                {"name": "话轮适配", "attempt1": 50, "attempt2": 72},
                {"name": "副语言", "attempt1": 62, "attempt2": 68},
            ],
            "gap_improvements": [
                {
                    "gap_type": "语用得体性",
                    "improved": True,
                    "improvement": 30,
                    "description": '成功使用了礼貌用语 "Could I have..." 和 "please"，语用得体性明显提升'
                },
                {
                    "gap_type": "词汇多样性",
                    "improved": True,
                    "improvement": 15,
                    "description": '使用了更多咖啡相关词汇，如 "caramel macchiato"，词汇表达更加丰富'
                },
                {
                    "gap_type": "话轮适配",
                    "improved": True,
                    "improvement": 22,
                    "description": "回答更加自然流畅，能够适当扩展对话内容"
                }
            ],
            "overall_judgment": "核心不足已得到有效改善，整体进步明显"
        }
        return mock_evaluation

class AIService:
    def __init__(self):
        self.use_mock = not settings.OPENAI_API_KEY or settings.OPENAI_API_KEY == "your-openai-api-key"
        if self.use_mock:
            self.mock_service = MockAIService()
    
    def analyze_image(self, image_url: str) -> Dict[str, Any]:
        if self.use_mock:
            return self.mock_service.analyze_image(image_url)
        
        import base64
        from openai import OpenAI
        
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "分析这张图片，识别场景要素：地点、人物关系、潜在任务、文化语境，输出JSON格式"},
                            {"type": "image_url", "image_url": {"url": image_url}}
                        ]
                    }
                ],
                response_format={"type": "json_object"}
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            return self.mock_service.analyze_image(image_url)
    
    def generate_poa_task(self, scene_info: Dict[str, Any]) -> Dict[str, Any]:
        if self.use_mock:
            return self.mock_service.generate_poa_task(scene_info)
        
        from openai import OpenAI
        
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        
        try:
            prompt = f"""根据以下场景信息生成POA驱动任务：
            {json.dumps(scene_info)}
            
            请输出JSON格式，包含：your_role, ai_role, goal, constraints, evaluation_criteria, new_plot_variant
            """
            
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            return self.mock_service.generate_poa_task(scene_info)
    
    def transcribe_audio(self, audio_url: str) -> str:
        if self.use_mock:
            return self.mock_service.transcribe_audio(audio_url)
        
        from openai import OpenAI
        
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        
        try:
            import requests
            audio_data = requests.get(audio_url).content
            import io
            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=io.BytesIO(audio_data)
            )
            return response.text
        except Exception as e:
            return self.mock_service.transcribe_audio(audio_url)
    
    def diagnose_performance(self, transcript: str, task: Dict[str, Any]) -> List[Dict[str, Any]]:
        if self.use_mock:
            return self.mock_service.diagnose_performance(transcript, task)
        
        from openai import OpenAI
        
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        
        try:
            prompt = f"""分析以下对话表现，识别Top 3核心不足：
            任务信息：{json.dumps(task)}
            对话文本：{transcript}
            
            请输出JSON格式，每个不足包含：type, evidence, consequence, target_improvement
            """
            
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            result = json.loads(response.choices[0].message.content)
            return result.get("gaps", []) if isinstance(result, dict) else result
        except Exception as e:
            return self.mock_service.diagnose_performance(transcript, task)
    
    def generate_input_pack(self, gaps: List[Dict[str, Any]]) -> Dict[str, Any]:
        if self.use_mock:
            return self.mock_service.generate_input_pack(gaps)
        
        from openai import OpenAI
        
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        
        try:
            prompt = f"""根据以下核心不足生成精准输入材料：
            {json.dumps(gaps)}
            
            请输出JSON格式，包含：vocabulary, patterns, model_dialogue, strategies
            """
            
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            return self.mock_service.generate_input_pack(gaps)
    
    def generate_exercises(self, gaps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if self.use_mock:
            return self.mock_service.generate_exercises(gaps)
        
        from openai import OpenAI
        
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        
        try:
            prompt = f"""根据以下核心不足生成2-3个短时练习：
            {json.dumps(gaps)}
            
            每个练习包含：question, options, correct_answer, explanation
            请输出JSON数组格式
            """
            
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            result = json.loads(response.choices[0].message.content)
            return result.get("exercises", []) if isinstance(result, dict) else result
        except Exception as e:
            return self.mock_service.generate_exercises(gaps)
    
    def evaluate_performance(
        self, 
        attempt1_transcript: str, 
        attempt2_transcript: str,
        task: Dict[str, Any],
        gaps: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        if self.use_mock:
            return self.mock_service.evaluate_performance(attempt1_transcript, attempt2_transcript, task, gaps)
        
        from openai import OpenAI
        
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        
        try:
            prompt = f"""对比两次对话表现，进行双轨评价：
            任务信息：{json.dumps(task)}
            核心不足：{json.dumps(gaps)}
            第一次对话：{attempt1_transcript}
            第二次对话：{attempt2_transcript}
            
            请输出JSON格式，包含：seven_dimension_scores（发音、语法、词汇、功能达成、语用得体、话轮适配、副语言）, gap_improvements, overall_judgment
            """
            
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            return self.mock_service.evaluate_performance(attempt1_transcript, attempt2_transcript, task, gaps)

ai_service = AIService()