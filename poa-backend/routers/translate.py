"""
Word translation endpoint using MyMemory free translation API.
Zero token cost, millisecond-level response.
"""
import logging

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("translate_router")

router = APIRouter(prefix="/api", tags=["translate"])

MYMEMORY_URL = "https://api.mymemory.translated.net/get"

# Common word pronunciations (IPA) for fallback when API doesn't provide them
PHONETIC_DICT: dict[str, str] = {
    "hello": "/həˈloʊ/",
    "goodbye": "/ɡʊdˈbaɪ/",
    "please": "/pliːz/",
    "thank": "/θæŋk/",
    "sorry": "/ˈsɒri/",
    "yes": "/jes/",
    "no": "/noʊ/",
    "morning": "/ˈmɔːrnɪŋ/",
    "evening": "/ˈiːvnɪŋ/",
    "night": "/naɪt/",
    "water": "/ˈwɔːtər/",
    "food": "/fuːd/",
    "money": "/ˈmʌni/",
    "time": "/taɪm/",
    "friend": "/frend/",
    "family": "/ˈfæməli/",
    "work": "/wɜːrk/",
    "school": "/skuːl/",
    "help": "/help/",
    "love": "/lʌv/",
    "like": "/laɪk/",
    "want": "/wɒnt/",
    "need": "/niːd/",
    "go": "/ɡoʊ/",
    "come": "/kʌm/",
    "make": "/meɪk/",
    "know": "/noʊ/",
    "think": "/θɪŋk/",
    "see": "/siː/",
    "say": "/seɪ/",
    "get": "/ɡet/",
    "take": "/teɪk/",
    "give": "/ɡɪv/",
    "tell": "/tel/",
    "ask": "/æsk/",
    "try": "/traɪ/",
    "call": "/kɔːl/",
    "keep": "/kiːp/",
    "let": "/let/",
    "begin": "/bɪˈɡɪn/",
    "seem": "/siːm/",
    "show": "/ʃoʊ/",
    "hear": "/hɪr/",
    "play": "/pleɪ/",
    "run": "/rʌn/",
    "move": "/muːv/",
    "live": "/lɪv/",
    "believe": "/bɪˈliːv/",
    "bring": "/brɪŋ/",
    "happen": "/ˈhæpən/",
    "write": "/raɪt/",
    "provide": "/prəˈvaɪd/",
    "sit": "/sɪt/",
    "stand": "/stænd/",
    "lose": "/luːz/",
    "pay": "/peɪ/",
    "meet": "/miːt/",
    "include": "/ɪnˈkluːd/",
    "continue": "/kənˈtɪnjuː/",
    "set": "/set/",
    "learn": "/lɜːrn/",
    "change": "/tʃeɪndʒ/",
    "lead": "/liːd/",
    "understand": "/ˌʌndərˈstænd/",
    "watch": "/wɒtʃ/",
    "follow": "/ˈfɒloʊ/",
    "stop": "/stɒp/",
    "create": "/kriˈeɪt/",
    "speak": "/spiːk/",
    "read": "/riːd/",
    "allow": "/əˈlaʊ/",
    "add": "/æd/",
    "spend": "/spend/",
    "grow": "/ɡroʊ/",
    "open": "/ˈoʊpən/",
    "walk": "/wɔːk/",
    "win": "/wɪn/",
    "offer": "/ˈɒfər/",
    "remember": "/rɪˈmembər/",
    "consider": "/kənˈsɪdər/",
    "appear": "/əˈpɪr/",
    "buy": "/baɪ/",
    "serve": "/sɜːrv/",
    "die": "/daɪ/",
    "send": "/send/",
    "build": "/bɪld/",
    "stay": "/steɪ/",
    "fall": "/fɔːl/",
    "cut": "/kʌt/",
    "reach": "/riːtʃ/",
    "kill": "/kɪl/",
    "remain": "/rɪˈmeɪn/",
    "suggest": "/səˈdʒest/",
    "raise": "/reɪz/",
    "pass": "/pæs/",
    "sell": "/sel/",
    "require": "/rɪˈkwaɪər/",
    "report": "/rɪˈpɔːrt/",
    "decide": "/dɪˈsaɪd/",
    "pull": "/pʊl/",
    "good": "/ɡʊd/",
    "bad": "/bæd/",
    "big": "/bɪɡ/",
    "small": "/smɔːl/",
    "new": "/njuː/",
    "old": "/oʊld/",
    "high": "/haɪ/",
    "low": "/loʊ/",
    "long": "/lɒŋ/",
    "short": "/ʃɔːrt/",
    "fast": "/fæst/",
    "slow": "/sloʊ/",
    "hot": "/hɒt/",
    "cold": "/koʊld/",
    "happy": "/ˈhæpi/",
    "sad": "/sæd/",
    "beautiful": "/ˈbjuːtɪfəl/",
    "important": "/ɪmˈpɔːrtənt/",
    "different": "/ˈdɪfərənt/",
    "available": "/əˈveɪləbəl/",
    "popular": "/ˈpɒpjʊlər/",
    "difficult": "/ˈdɪfɪkəlt/",
    "strong": "/strɒŋ/",
    "possible": "/ˈpɒsəbəl/",
    "special": "/ˈspeʃəl/",
    "natural": "/ˈnætʃərəl/",
    "simple": "/ˈsɪmpəl/",
    "clear": "/klɪr/",
    "easy": "/ˈiːzi/",
    "real": "/riːl/",
    "true": "/truː/",
    "sure": "/ʃʊr/",
    "able": "/ˈeɪbəl/",
    "early": "/ˈɜːrli/",
    "late": "/leɪt/",
    "free": "/friː/",
    "full": "/fʊl/",
    "kind": "/kaɪnd/",
    "serious": "/ˈsɪriəs/",
    "common": "/ˈkɒmən/",
    "pretty": "/ˈprɪti/",
    "bright": "/braɪt/",
    "dark": "/dɑːrk/",
    "quiet": "/ˈkwaɪət/",
    "loud": "/laʊd/",
    "soft": "/sɒft/",
    "hard": "/hɑːrd/",
    "deep": "/diːp/",
    "wide": "/waɪd/",
    "clean": "/kliːn/",
    "dirty": "/ˈdɜːrti/",
    "sweet": "/swiːt/",
    "fresh": "/freʃ/",
    "busy": "/ˈbɪzi/",
    "careful": "/ˈkerfəl/",
    "comfortable": "/ˈkʌmfətəbəl/",
    "delicious": "/dɪˈlɪʃəs/",
    "excellent": "/ˈeksələnt/",
    "famous": "/ˈfeɪməs/",
    "friendly": "/ˈfrendli/",
    "helpful": "/ˈhelpfəl/",
    "hungry": "/ˈhʌŋɡri/",
    "interesting": "/ˈɪntrəstɪŋ/",
    "necessary": "/ˈnesəsəri/",
    "patient": "/ˈpeɪʃənt/",
    "polite": "/pəˈlaɪt/",
    "powerful": "/ˈpaʊərfəl/",
    "quiet": "/ˈkwaɪət/",
    "reasonable": "/ˈriːzənəbəl/",
    "successful": "/səkˈsesfəl/",
    "useful": "/ˈjuːsfəl/",
    "wonderful": "/ˈwʌndərfəl/",
    "coffee": "/ˈkɒfi/",
    "tea": "/tiː/",
    "milk": "/mɪlk/",
    "breakfast": "/ˈbrekfəst/",
    "lunch": "/lʌntʃ/",
    "dinner": "/ˈdɪnər/",
    "order": "/ˈɔːrdər/",
    "menu": "/ˈmenjuː/",
    "restaurant": "/ˈrestərɒnt/",
    "hotel": "/hoʊˈtel/",
    "airport": "/ˈerpɔːrt/",
    "ticket": "/ˈtɪkɪt/",
    "doctor": "/ˈdɒktər/",
    "medicine": "/ˈmedɪsɪn/",
    "phone": "/foʊn/",
    "computer": "/kəmˈpjuːtər/",
    "internet": "/ˈɪntərnet/",
    "email": "/ˈiːmeɪl/",
    "address": "/əˈdres/",
    "weather": "/ˈweðər/",
    "today": "/təˈdeɪ/",
    "tomorrow": "/təˈmɒroʊ/",
    "yesterday": "/ˈjestərdeɪ/",
    "week": "/wiːk/",
    "month": "/mʌnθ/",
    "year": "/jɪr/",
    "city": "/ˈsɪti/",
    "country": "/ˈkʌntri/",
    "world": "/wɜːrld/",
    "people": "/ˈpiːpəl/",
    "woman": "/ˈwʊmən/",
    "child": "/tʃaɪld/",
    "parent": "/ˈperənt/",
    "teacher": "/ˈtiːtʃər/",
    "student": "/ˈstuːdənt/",
    "question": "/ˈkwestʃən/",
    "answer": "/ˈænsər/",
    "problem": "/ˈprɒbləm/",
    "idea": "/aɪˈdiːə/",
    "example": "/ɪɡˈzæmpəl/",
    "information": "/ˌɪnfərˈmeɪʃən/",
    "experience": "/ɪkˈspɪriəns/",
    "education": "/ˌedʒʊˈkeɪʃən/",
    "language": "/ˈlæŋɡwɪdʒ/",
    "conversation": "/ˌkɒnvərˈseɪʃən/",
    "situation": "/ˌsɪtʃuˈeɪʃən/",
    "opportunity": "/ˌɒpərˈtjuːnəti/",
    "recommendation": "/ˌrekəmenˈdeɪʃən/",
    "appointment": "/əˈpɔɪntmənt/",
    "reservation": "/ˌrezərˈveɪʃən/",
    "complaint": "/kəmˈpleɪnt/",
    "assistance": "/əˈsɪstəns/",
    "preference": "/ˈprefərəns/",
    "allergy": "/ˈælərdʒi/",
    "ingredient": "/ɪnˈɡriːdiənt/",
    "discount": "/ˈdɪskaʊnt/",
    "receipt": "/rɪˈsiːt/",
    "refund": "/ˈriːfʌnd/",
    "delivery": "/dɪˈlɪvəri/",
    "available": "/əˈveɪləbəl/",
    "schedule": "/ˈskedʒuːl/",
    "confirm": "/kənˈfɜːrm/",
    "cancel": "/ˈkænsəl/",
    "apologize": "/əˈpɒlədʒaɪz/",
    "explain": "/ɪkˈspleɪn/",
    "describe": "/dɪˈskraɪb/",
    "suggest": "/səˈdʒest/",
    "recommend": "/ˌrekəˈmend/",
    "request": "/rɪˈkwest/",
    "complain": "/kəmˈpleɪn/",
    "invite": "/ɪnˈvaɪt/",
    "introduce": "/ˌɪntrəˈdjuːs/",
    "compare": "/kəmˈper/",
    "prefer": "/prɪˈfɜːr/",
    "arrange": "/əˈreɪndʒ/",
    "prepare": "/prɪˈper/",
    "manage": "/ˈmænɪdʒ/",
    "accept": "/əkˈsept/",
    "refuse": "/rɪˈfjuːz/",
    "agree": "/əˈɡriː/",
    "discuss": "/dɪˈskʌs/",
    "mention": "/ˈmenʃən/",
    "promise": "/ˈprɒmɪs/",
    "worry": "/ˈwʌri/",
    "enjoy": "/ɪnˈdʒɔɪ/",
    "imagine": "/ɪˈmædʒɪn/",
    "realize": "/ˈriːəlaɪz/",
    "notice": "/ˈnoʊtɪs/",
    "recognize": "/ˈrekəɡnaɪz/",
    "forget": "/fərˈɡet/",
}


class TranslateRequest(BaseModel):
    word: str


class TranslateResponse(BaseModel):
    translation: str
    phonetic: str


@router.post("/translate", response_model=TranslateResponse)
async def translate_word(req: TranslateRequest):
    """
    Translate an English word to Chinese using MyMemory free translation API.
    Zero token cost, millisecond-level response.
    Falls back to built-in phonetic dictionary when API doesn't provide phonetics.
    """
    word = req.word.strip().lower()
    if not word:
        return TranslateResponse(translation="", phonetic="")

    phonetic = PHONETIC_DICT.get(word, "")

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                MYMEMORY_URL,
                params={"q": word, "langpair": "en|zh-CN"},
            )
            resp.raise_for_status()
            data = resp.json()

        translation = ""
        if data.get("responseStatus") == 200:
            translation = data.get("responseData", {}).get("translatedText", "")

        translation = translation.strip() if translation else ""

        if not translation:
            return TranslateResponse(translation="词义未收录", phonetic=phonetic)

        logger.info(f"[translate] word={word!r} → translation={translation!r}, phonetic={phonetic!r}")
        return TranslateResponse(translation=translation, phonetic=phonetic)

    except Exception as e:
        logger.warning(f"[translate] Translation failed word={word!r}: {e}")
        if phonetic:
            return TranslateResponse(translation="翻译暂不可用", phonetic=phonetic)
        return TranslateResponse(translation="翻译暂不可用", phonetic="")
