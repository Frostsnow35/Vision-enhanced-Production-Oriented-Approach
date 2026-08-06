"""
对话路由 —— AI 开场白 + WebSocket 流式 ASR + 对话轮次（LLM → TTS）。

新架构：
  /api/chat/start       — AI 开场白 + TTS
  /api/chat/asr-stream  — WebSocket 流式 ASR（前端 PCM → 后端代理 → 火山流式 ASR）
  /api/chat/turn        — 用户文本 → LLM 回复 → TTS（不再含音频→ASR）
  /api/asr/token        — 获取火山 ASR 直连鉴权 Token（前端直连火山，绕过 Railway 跨境 WS）
"""
import asyncio
import json
import logging

import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.chat_service import generate_opening, generate_reply, text_to_speech, _generate_turn_feedback
from services.asr_service import VolcanoStreamASR
from config import DOUBAO_ASR_APP_ID, DOUBAO_ASR_TOKEN, DOUBAO_ASR_STREAM_RESOURCE_ID, DOUBAO_ASR_STREAM_URL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chat_router")

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _clip_text(text: str, limit: int = 160) -> str:
    """裁剪日志文本，避免单条日志过长。"""
    value = "" if text is None else str(text)
    value = value.replace("\n", "\\n")
    if len(value) <= limit:
        return value
    return value[:limit] + "..."


def _serialize_history_for_log(conversation_history: list) -> str:
    """压缩 conversation_history，便于在日志中查看关键字段。"""
    preview = []
    for turn in conversation_history[-6:]:
        preview.append(
            {
                "role": turn.get("role", ""),
                "text": _clip_text(turn.get("text") or turn.get("content") or "", 120),
            }
        )
    return json.dumps(preview, ensure_ascii=False)


# ---- 请求/响应模型 ----

from pydantic import BaseModel

class ChatStartRequest(BaseModel):
    task_id: int = 0
    is_variant: bool = False
    variant_context: str = ""
    scene_label: str = ""
    roles: str = ""
    goal: str = ""
    evaluation_criteria: str = ""
    opening_line: str = ""


class ChatStartResponse(BaseModel):
    ai_text: str
    ai_audio_url: str


class ChatTurnRequest(BaseModel):
    task_id: int = 0
    user_text: str = ""
    conversation_history: list = []
    scene_label: str = ""
    roles: str = ""
    goal: str = ""
    evaluation_criteria: str = ""
    variant_context: str = ""
    closing_line: str = ""


class ChatTurnResponse(BaseModel):
    ai_text: str
    ai_audio_url: str
    is_final: bool = False
    turn_feedback: dict = {}
    user_text: str = ""
    llm_error: str = ""
    asr_error: str = ""


# ---- GET /api/asr/token —— 火山 ASR 直连鉴权 Token ----

@router.get("/asr/token")
async def get_asr_token():
    """
    为前端提供火山引擎流式 ASR 直连所需的临时鉴权 Token。
    
    前端浏览器直连 wss://openspeech.bytedance.com/api/v3/sauc/bigmodel
    （绕过 Railway 跨境 WebSocket，避免被国内 ISP 阻断），
    鉴权信息通过 URL query 参数传递。
    
    返回:
        {
            "token": "eyJ...",          // STS 临时 JWT，有效期 5 分钟
            "appid": "...",             // 火山应用 ID
            "resource_id": "volc.bigasr.sauc.duration",
            "stream_url": "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
        }
    
    若无 ASR 凭据（appid + token），返回 503。
    """
    if not DOUBAO_ASR_APP_ID or not DOUBAO_ASR_TOKEN:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={
                "detail": "ASR 直连模式未配置：缺少 DOUBAO_ASR_APP_ID / DOUBAO_ASR_TOKEN",
                "asr_configured": False,
            },
        )
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://openspeech.bytedance.com/api/v1/sts/token",
                headers={
                    "Authorization": f"Bearer; {DOUBAO_ASR_TOKEN}",
                    "Content-Type": "application/json",
                },
                json={"appid": DOUBAO_ASR_APP_ID, "duration": 300},
            )
            if resp.status_code != 200:
                logger.warning(
                    f"[ASR/Token] STS API 返回 {resp.status_code}: "
                    f"{resp.text[:300]}"
                )
                from fastapi.responses import JSONResponse
                return JSONResponse(
                    status_code=502,
                    content={
                        "detail": f"火山 STS Token 接口返回 {resp.status_code}",
                        "asr_configured": True,
                    },
                )
            data = resp.json()
            jwt_token = data.get("jwt_token") or data.get("token") or data.get("access_token") or ""
            if not jwt_token:
                logger.warning(f"[ASR/Token] STS API 未返回 jwt_token: {json.dumps(data, ensure_ascii=False)[:300]}")
                from fastapi.responses import JSONResponse
                return JSONResponse(
                    status_code=502,
                    content={"detail": "火山 STS Token 接口未返回有效 token", "asr_configured": True},
                )
            logger.info(f"[ASR/Token] 已获取 STS Token (len={len(jwt_token)})")
            return {
                "token": jwt_token,
                "appid": DOUBAO_ASR_APP_ID,
                "resource_id": DOUBAO_ASR_STREAM_RESOURCE_ID,
                "stream_url": DOUBAO_ASR_STREAM_URL,
            }
    except httpx.TimeoutException:
        logger.error("[ASR/Token] STS API 超时")
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=504, content={"detail": "火山 STS Token 接口超时", "asr_configured": True})
    except Exception as e:
        logger.error(f"[ASR/Token] 异常: {e}")
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=500,
            content={"detail": f"获取 ASR Token 失败: {e}", "asr_configured": True},
        )


# ---- WebSocket 流式 ASR 端点 ----

@router.websocket("/asr-stream")
async def asr_stream(ws: WebSocket):
    """
    WebSocket 端点：接收前端 PCM 音频流，代理转发至火山流式 ASR（双向流式）。
    
    协议：
      前端 → 后端: 二进制帧（PCM 16kHz 16bit mono）
      前端 → 后端: JSON 文本帧 {"action": "stop"}（用户停止说话）
      后端 → 前端: JSON 文本帧 {"type": "interim", "text": "..."}（实时识别）
      后端 → 前端: JSON 文本帧 {"type": "final", "text": "..."}（最终结果）
    """
    await ws.accept()
    client_info = f"{ws.client.host}:{ws.client.port}" if ws.client else "unknown"
    logger.info(f"[ASR-Stream] 前端 WebSocket 已连接 client={client_info}")

    asr = VolcanoStreamASR()
    try:
        # 1. 建立与火山的 WebSocket 连接并发送首帧
        await asr.connect()
        await asr.start()
        logger.info("[ASR-Stream] 火山流式 ASR 就绪，等待前端音频...")
    except Exception as e:
        logger.error(f"[ASR-Stream] 火山连接失败: {e}")
        try:
            await ws.send_json({"type": "error", "message": f"ASR 连接失败: {e}"})
        except Exception:
            pass
        try:
            await ws.close()
        except Exception:
            pass
        return

    stop_flag = False
    final_holder = {"text": ""}
    done_event = asyncio.Event()
    audio_frame_count = 0  # 从前端收到的 PCM 帧计数
    pcm_verify_done = False  # 前3帧已做诊断

    async def _receiver():
        """持续读取火山响应：推送 interim 字幕，收到 final 后结束。"""
        timeout_count = 0
        nonlocal audio_frame_count
        try:
            while True:
                result = await asr.receive_once(timeout=15.0)
                if result is None:
                    timeout_count += 1
                    if timeout_count >= 4:
                        logger.warning(f"[ASR-Stream] 火山连续无响应（已收{audio_frame_count}个音频包），结束接收")
                        break
                    continue
                timeout_count = 0
                text, is_final = result
                if text and not is_final:
                    try:
                        await ws.send_json({"type": "interim", "text": text})
                        logger.info(f"[ASR-Stream→前端] interim: '{_clip_text(text, 60)}'")
                    except Exception:
                        break
                if is_final:
                    final_holder["text"] = text
                    logger.info(f"[ASR-Stream→前端] final: '{_clip_text(text, 100)}'")
                    break
        except Exception as e:
            logger.warning(f"[ASR-Stream] 接收协程异常: {e}")
        finally:
            done_event.set()

    recv_task = asyncio.create_task(_receiver())

    try:
        # 2. 转发前端音频到火山，同时监听 stop 控制消息
        while not stop_flag:
            try:
                data = await ws.receive()
            except WebSocketDisconnect:
                logger.info(f"[ASR-Stream] 前端 WebSocket 断开（已收{audio_frame_count}个音频包）")
                break

            if "bytes" in data:
                pcm_bytes = data["bytes"]
                audio_frame_count += 1

                # 前 3 帧做 PCM 诊断：确认音频是否有数据（非全零）且字节序合理
                if not pcm_verify_done and audio_frame_count <= 3:
                    samples = len(pcm_bytes) // 2  # 16-bit
                    # 抽样检查 Int16 值的范围（跳过全部 6400 个样本的遍历）
                    zero_count = 0
                    total = samples
                    all_zero = True
                    sample_values = []
                    for i in range(0, len(pcm_bytes), 2):
                        val = int.from_bytes(pcm_bytes[i:i + 2], "little", signed=True)
                        if val != 0:
                            all_zero = False
                        else:
                            zero_count += 1
                        if len(sample_values) < 10:
                            sample_values.append(val)
                    logger.info(
                        f"[ASR-Stream←前端] 音频帧 #{audio_frame_count} "
                        f"size={len(pcm_bytes)}B samples={samples} "
                        f"all_zero={all_zero} zero_pct={zero_count / total * 100:.1f}% "
                        f"first10={sample_values}"
                    )
                    if audio_frame_count >= 3:
                        pcm_verify_done = True

                await asr.send_audio(pcm_bytes)
                if audio_frame_count <= 3:
                    logger.info(f"[ASR-Stream←前端] 音频帧 #{audio_frame_count} 大小={len(pcm_bytes)}B")
                elif audio_frame_count % 30 == 0:
                    logger.info(f"[ASR-Stream←前端] 已收 {audio_frame_count} 个音频帧")
            elif "text" in data:
                try:
                    ctrl = json.loads(data["text"])
                    if ctrl.get("action") == "stop":
                        logger.info(f"[ASR-Stream] 前端请求停止（已收{audio_frame_count}个音频包）")
                        stop_flag = True
                except json.JSONDecodeError:
                    pass
    except Exception as e:
        logger.error(f"[ASR-Stream] 主循环异常: {e}")

    # 3. 发送结束帧（负包），等待火山返回最终结果
    try:
        await asr.finish()
    except Exception as e:
        logger.warning(f"[ASR-Stream] finish() 异常: {e}")

    try:
        await asyncio.wait_for(done_event.wait(), timeout=12.0)
    except asyncio.TimeoutError:
        logger.warning("[ASR-Stream] 等待最终结果超时")
    finally:
        if not recv_task.done():
            recv_task.cancel()

    # 4. 将最终结果回传前端
    final_text = final_holder["text"]
    try:
        await ws.send_json({"type": "final", "text": final_text})
        logger.info(f"[ASR-Stream→前端] 已推送 final 给前端: '{_clip_text(final_text, 100)}'")
    except Exception:
        pass

    # 5. 清理
    await asr.close()
    try:
        await ws.close()
    except Exception:
        pass

    logger.info(f"[ASR-Stream] 会话结束: audio_frames={audio_frame_count} final='{_clip_text(final_text, 100)}'")


# ---- POST /api/chat/start ----

@router.post("/start", response_model=ChatStartResponse)
async def chat_start(req: ChatStartRequest):
    """
    生成 AI 开场白 + TTS 语音。
    文字秒返回；若 TTS 缓存命中则带音频 URL，否则后台生成、前端用浏览器语音。
    """
    import time as _time
    _t0 = _time.time()

    task_context = {
        "scene_label": req.scene_label,
        "roles": req.roles,
        "goal": req.goal,
        "evaluation_criteria": req.evaluation_criteria,
        "variant_context": req.variant_context if req.is_variant else "",
    }

    if req.opening_line and req.opening_line.strip():
        ai_text = req.opening_line.strip()
        logger.info(f"[chat/start] 使用预生成 opening_line: {ai_text[:60]}")
    else:
        ai_text = generate_opening(task_context)

    ai_audio_url = ""
    if ai_text:
        try:
            # TTS 可能因豆包降级 gTTS 而长时间阻塞（gTTS 内部 HTTP 无超时）
            # 用线程池 + 8 秒超时，超时后返回空 URL，前端自动降级浏览器语音
            from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
            with ThreadPoolExecutor(max_workers=1) as tts_pool:
                future = tts_pool.submit(text_to_speech, ai_text)
                try:
                    ai_audio_url = future.result(timeout=8.0) or ""
                except FutureTimeout:
                    logger.warning(f"[chat/start] TTS 超时（>8s），返回文字不等待音频")
        except Exception as ex:
            logger.warning(f"[chat/start] TTS 生成失败: {ex}")

    logger.info(f"[chat/start] 响应耗时: {(_time.time() - _t0)*1000:.0f}ms, has_audio={bool(ai_audio_url)}")
    return ChatStartResponse(ai_text=ai_text, ai_audio_url=ai_audio_url)


# ---- POST /api/chat/tts（独立 TTS）----

class TTSRequest(BaseModel):
    text: str


class TTSResponse(BaseModel):
    audio_url: str


@router.post("/tts", response_model=TTSResponse)
async def chat_tts(req: TTSRequest):
    url = text_to_speech(req.text) if req.text else ""
    return TTSResponse(audio_url=url)


# ---- POST /api/chat/turn ----

@router.post("/turn", response_model=ChatTurnResponse)
async def chat_turn(req: ChatTurnRequest):
    """
    处理一个对话轮次（精简版）。
    
    前端已通过 WebSocket 流式 ASR 获取 user_text，此端点仅负责：
      user_text → LLM 生成回复 → TTS 合成语音 → 返回
    
    不再包含音频上传 / 转码 / ASR 逻辑。
    """
    task_context = {
        "scene_label": req.scene_label,
        "roles": req.roles,
        "goal": req.goal,
        "evaluation_criteria": req.evaluation_criteria,
        "variant_context": req.variant_context,
        "closing_line": req.closing_line,
    }

    user_text = req.user_text.strip()
    asr_error = ""

    logger.info(
        f"[chat/turn] 收到请求: user_text={_clip_text(user_text, 200)}, "
        f"history_count={len(req.conversation_history)}, "
        f"history_preview={_serialize_history_for_log(req.conversation_history)}"
    )

    # 无文本 → [inaudible] 兜底
    if not user_text:
        user_text = "[inaudible]"
        asr_error = "no_text_received"

    # 生成回复
    llm_error = ""
    try:
        ai_text, is_final = generate_reply(
            conversation_history=req.conversation_history,
            user_text=user_text,
            task_context=task_context,
        )
    except RuntimeError as e:
        llm_error = str(e)
        logger.error(f"[chat/turn] 模型调用失败: {llm_error}")
        return ChatTurnResponse(
            ai_text=f"[模型调用失败] {llm_error}",
            ai_audio_url="",
            is_final=False,
            turn_feedback={},
            user_text=user_text if user_text != "[inaudible]" else "",
            llm_error=llm_error,
            asr_error=asr_error,
        )

    # TTS 与实时短反馈并行执行
    turn_feedback: dict = {}
    ai_audio_url = ""
    try:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool:
            tts_future = pool.submit(lambda: text_to_speech(ai_text) if ai_text else "")
            fb_future = pool.submit(_generate_turn_feedback, user_text, ai_text, task_context)
            ai_audio_url = tts_future.result()
            turn_feedback = fb_future.result()
    except Exception as e:
        logger.warning(f"[chat/turn] TTS/反馈并行执行异常: {e}")

    response_user_text = user_text if user_text != "[inaudible]" else ""
    logger.info(
        f"[chat/turn] 回传: ai_text={_clip_text(ai_text, 200)}, "
        f"user_text={_clip_text(response_user_text, 200)}, "
        f"is_final={is_final}, has_audio={bool(ai_audio_url)}"
    )

    return ChatTurnResponse(
        ai_text=ai_text,
        ai_audio_url=ai_audio_url,
        is_final=is_final,
        turn_feedback=turn_feedback,
        user_text=response_user_text,
        asr_error=asr_error,
    )
