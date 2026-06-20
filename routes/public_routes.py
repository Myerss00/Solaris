# routes/public_routes.py
"""Public, unauthenticated routes for the Solaris marketing site:
ad-gated free generation (/api/ads/*, /api/generate/*) and the
transparency page (/api/impact/*). None of these touch the owner/session
auth model — there is no logged-in user here, just anonymous visitors.
"""

import asyncio
import base64
import logging
import os
import re
import secrets
import shutil
import subprocess
import uuid
from datetime import datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, model_validator

from core.database import (
    AdRewardToken,
    EmailSignup,
    ImpactFeedEntry,
    ImpactProject,
    ImpactStat,
    SessionLocal,
    VideoJob,
    utcnow_naive,
)
from src.constants import DATA_DIR

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Friendly placeholder shown whenever generation can't actually run (missing
# token, HF error, network failure). Never surfaces the underlying exception
# to the end user — only this one fixed message.
NO_TOKEN_MESSAGE = "Connecting to the generator... If you're the administrator, add HUGGINGFACE_TOKEN to your .env"
NO_TTS_MESSAGE = "Connecting to the voice engine... If you're the administrator, install espeak-ng on the server"
# Unlike images/audio/text, there is currently no free, working text-to-video
# model reachable through HuggingFace's free router — every option we tried
# (i2vgen-xl, text-to-video-ms-1.7b, CogVideoX, LTX-Video) answers "Model not
# supported by provider hf-inference". This is an honest failure message, not
# a fake "still processing" — video stays wired up so it starts working the
# moment a real provider is plugged in.
NO_VIDEO_MESSAGE = "Video generation isn't connected to a free model yet — try Images, Audio, or Text while we look for a free option for video. 🎬"
VIDEO_PROCESSING_MESSAGE = "Your video is being generated. This may take 2-5 minutes."

logger = logging.getLogger(__name__)

HF_MODEL = "black-forest-labs/FLUX.1-schnell"
# HuggingFace retired api-inference.huggingface.co in favor of the Inference
# Providers router — the old hostname no longer resolves at all.
HF_INFERENCE_URL = f"https://router.huggingface.co/hf-inference/models/{HF_MODEL}"

# Text-to-speech: every free HuggingFace TTS model (including
# facebook/mms-tts-eng) has been pulled from the free hf-inference router —
# they all answer "Model not supported by provider hf-inference" now. espeak-ng
# is the documented fallback: a real, fully offline, zero-cost TTS engine, so
# we shell out to it instead. Voice presets below map to espeak-ng's built-in
# voice variants + pitch/speed flags — "child" is approximated via a higher
# pitch since espeak-ng has no dedicated child voice.
ESPEAK_VOICE_ARGS = {
    "default": ["-v", "en"],
    "male": ["-v", "en+m3"],
    "female": ["-v", "en+f3"],
    "child": ["-v", "en+f4", "-p", "80", "-s", "180"],
}

# Free instruction-following chat model for posts/scripts/emails/translation/
# summaries. mistralai/Mistral-7B-Instruct-v0.3 is no longer routable through
# HuggingFace's free hf-inference provider ("Model not supported by provider
# hf-inference"); Qwen2.5-7B-Instruct is the closest free substitute that
# still works through HF's unified chat-completions router.
TEXT_MODEL = "Qwen/Qwen2.5-7B-Instruct"
TEXT_INFERENCE_URL = "https://router.huggingface.co/v1/chat/completions"

# Text-to-video — tried in this order. Neither currently answers through the
# free hf-inference router (see NO_VIDEO_MESSAGE above), but kept as the
# primary/fallback pair so this starts working immediately if HF re-enables
# either one, with zero code changes.
VIDEO_MODELS = ["ali-vilab/i2vgen-xl", "damo-vilab/text-to-video-ms-1.7b"]
VIDEO_INFERENCE_URLS = [f"https://router.huggingface.co/hf-inference/models/{m}" for m in VIDEO_MODELS]

# Generated audio files for anonymous visitors — served back by filename only
# (see /api/public-audio/{filename}), never by path, so traversal isn't possible.
PUBLIC_AUDIO_DIR = os.path.join(DATA_DIR, "public_audio")
os.makedirs(PUBLIC_AUDIO_DIR, exist_ok=True)
_AUDIO_FILENAME_RE = re.compile(r"^[0-9a-f]{32}\.wav$")

# Generated video files — same filename-only serving pattern as audio.
PUBLIC_VIDEO_DIR = os.path.join(DATA_DIR, "public_video")
os.makedirs(PUBLIC_VIDEO_DIR, exist_ok=True)
_VIDEO_FILENAME_RE = re.compile(r"^[0-9a-f]{32}\.mp4$")

# Per-task instruction template for the free text tools.
TEXT_TASK_PROMPTS = {
    "social_post": "Write a short, engaging social media post about: {prompt}",
    "script": "Write a short video script, with brief scene directions, about: {prompt}",
    "email": "Write a clear, professional email about: {prompt}",
    "translate": "Translate the following text into English. If it is already in English, translate it into Spanish instead. Only output the translation:\n\n{prompt}",
    "summarize": "Summarize the following text concisely, in a few sentences:\n\n{prompt}",
}

# Every tier requires at least 2 rewarded ads — there is no free tier.
# Each ad lasts 30s, so required_seconds = ad_count * 30.
SECONDS_PER_AD = 30

AD_AD_COUNTS = {
    "basic": 2,
    "hd": 3,
    "4k": 4,
    "audio": 3,
    "text": 2,
    "video_5s": 3,
    "video_10s": 4,
    "video_25s": 5,
}

# tier -> seconds the client must wait before the ad-reward token verifies
AD_TIERS = {tier: count * SECONDS_PER_AD for tier, count in AD_AD_COUNTS.items()}

# Stat keys shown on /impact — every one starts at 0 until the admin
# endpoint records a real number.
IMPACT_STAT_KEYS = ("images_generated", "videos_created", "donated_usd", "schools_funded")


class AdStartRequest(BaseModel):
    tier: str


class AdVerifyRequest(BaseModel):
    token: str


class GenerateImageRequest(BaseModel):
    prompt: str
    style: Optional[str] = None
    tier: Optional[str] = None
    # Frontend may send `quality: "basic"/"hd"/"4k"` instead of `tier` —
    # both spellings are accepted and normalized to `tier` below.
    quality: Optional[str] = None
    ad_token: Optional[str] = None

    @model_validator(mode="after")
    def _normalize_tier(self):
        raw = (self.tier or self.quality or "basic").lower()
        self.tier = "basic" if raw in ("basic", "basica") else raw
        return self


class GenerateAudioRequest(BaseModel):
    text: str
    voice: Optional[str] = "default"
    ad_token: Optional[str] = None


class GenerateTextRequest(BaseModel):
    prompt: str
    task: str = "social_post"
    ad_token: Optional[str] = None


class GenerateVideoRequest(BaseModel):
    prompt: str
    duration: str = "video_5s"  # "video_5s" | "video_10s" | "video_25s"
    ad_token: Optional[str] = None


class SignupRequest(BaseModel):
    email: str
    feature: str  # "video" — the only category still without a connected model


class ImpactStatsUpdate(BaseModel):
    stats: Optional[dict] = None
    project: Optional[dict] = None  # {id, name, icon, goal_usd, raised_usd, is_active, sort_order}
    feed_entry: Optional[dict] = None  # {amount_usd, description, occurred_at}


def _require_admin_key(x_admin_key: Optional[str]) -> None:
    expected = os.getenv("ADMIN_API_KEY", "")
    if not expected or not x_admin_key or not secrets.compare_digest(x_admin_key, expected):
        raise HTTPException(401, "Invalid admin key")


def setup_public_routes() -> APIRouter:
    router = APIRouter(tags=["public"])

    # ------------------------------------------------------------------
    # Ad-reward gate
    # ------------------------------------------------------------------

    @router.post("/api/ads/start")
    async def ads_start(body: AdStartRequest):
        if body.tier not in AD_TIERS:
            raise HTTPException(400, f"Unknown tier '{body.tier}'")
        token = uuid.uuid4().hex
        db = SessionLocal()
        try:
            row = AdRewardToken(
                token=token,
                tier=body.tier,
                required_seconds=AD_TIERS[body.tier],
            )
            db.add(row)
            db.commit()
        finally:
            db.close()
        return {
            "token": token,
            "required_seconds": AD_TIERS[body.tier],
            "ad_count": AD_AD_COUNTS[body.tier],
            "seconds_per_ad": SECONDS_PER_AD,
        }

    @router.post("/api/ads/verify")
    async def ads_verify(body: AdVerifyRequest):
        db = SessionLocal()
        try:
            row = db.query(AdRewardToken).filter(AdRewardToken.token == body.token).first()
            if not row:
                raise HTTPException(404, "Unknown ad token")
            if row.used:
                raise HTTPException(400, "Token already used")
            elapsed = (utcnow_naive() - row.created_at).total_seconds()
            if elapsed < row.required_seconds:
                raise HTTPException(400, f"Wait {row.required_seconds - int(elapsed)} more second(s)")
            row.used = True
            row.verified_at = utcnow_naive()
            db.commit()
        finally:
            db.close()
        return {"ok": True}

    # ------------------------------------------------------------------
    # Free generation (HuggingFace-backed image generation)
    # ------------------------------------------------------------------

    def _spend_ad_token(token: str, tier: str) -> None:
        """Consume a verified ad token for one generation. Raises if the
        token doesn't exist, doesn't match the tier, or was already spent."""
        db = SessionLocal()
        try:
            row = db.query(AdRewardToken).filter(AdRewardToken.token == token).first()
            if not row or not row.used or not row.verified_at:
                raise HTTPException(400, "Ad not verified — watch the ad first")
            if row.tier != tier:
                raise HTTPException(400, "Ad token does not match the requested tier")
            db.delete(row)
            db.commit()
        finally:
            db.close()

    def _increment_impact_stat(key: str) -> None:
        """Bump a real, automatic usage counter (e.g. images_generated) by 1.
        Unlike the admin-curated stats (donated_usd, schools_funded), this one
        reflects actual generations as they happen — no admin step needed."""
        db = SessionLocal()
        try:
            row = db.query(ImpactStat).filter(ImpactStat.key == key).first()
            if row:
                row.value += 1
            else:
                db.add(ImpactStat(key=key, value=1))
            db.commit()
        finally:
            db.close()

    @router.post("/api/generate/image")
    async def generate_image(body: GenerateImageRequest):
        prompt = body.prompt.strip()
        if not prompt:
            raise HTTPException(400, "prompt is required")

        if not body.ad_token:
            raise HTTPException(400, "ad_token is required — watch the ads first")
        _spend_ad_token(body.ad_token, body.tier)

        hf_token = os.getenv("HUGGINGFACE_TOKEN", "")
        if not hf_token:
            return {"ok": False, "status": "placeholder", "message": NO_TOKEN_MESSAGE}

        full_prompt = prompt if not body.style else f"{prompt}, {body.style} style"
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    HF_INFERENCE_URL,
                    headers={"Authorization": f"Bearer {hf_token}"},
                    json={"inputs": full_prompt},
                )
            if resp.status_code != 200 or not resp.headers.get("content-type", "").startswith("image/"):
                logger.warning("HuggingFace generation failed: %s %s", resp.status_code, resp.text[:200])
                return {"ok": False, "status": "placeholder", "message": NO_TOKEN_MESSAGE}
            image_b64 = base64.b64encode(resp.content).decode("ascii")
            content_type = resp.headers.get("content-type", "image/jpeg")
        except httpx.HTTPError as e:
            logger.warning("HuggingFace request error: %s", e)
            return {"ok": False, "status": "placeholder", "message": NO_TOKEN_MESSAGE}

        _increment_impact_stat("images_generated")
        return {"ok": True, "image_data_url": f"data:{content_type};base64,{image_b64}"}

    # ------------------------------------------------------------------
    # Free generation (espeak-ng-backed text-to-speech)
    # ------------------------------------------------------------------

    def _run_espeak(text: str, voice_args: list, out_path: str) -> None:
        """Blocking subprocess call — always run via asyncio.to_thread."""
        subprocess.run(
            ["espeak-ng", *voice_args, "-w", out_path, text],
            check=True,
            capture_output=True,
            timeout=30,
        )

    @router.post("/api/generate/audio")
    async def generate_audio(body: GenerateAudioRequest):
        text = body.text.strip()
        if not text:
            raise HTTPException(400, "text is required")

        if not body.ad_token:
            raise HTTPException(400, "ad_token is required — watch the ads first")
        _spend_ad_token(body.ad_token, "audio")

        if not shutil.which("espeak-ng"):
            return {"ok": False, "status": "placeholder", "message": NO_TTS_MESSAGE}

        voice_args = ESPEAK_VOICE_ARGS.get(body.voice, ESPEAK_VOICE_ARGS["default"])
        filename = f"{uuid.uuid4().hex}.wav"
        out_path = os.path.join(PUBLIC_AUDIO_DIR, filename)
        try:
            await asyncio.to_thread(_run_espeak, text, voice_args, out_path)
        except (subprocess.SubprocessError, OSError) as e:
            logger.warning("espeak-ng TTS failed: %s", e)
            return {"ok": False, "status": "placeholder", "message": NO_TTS_MESSAGE}

        return {"ok": True, "audio_url": f"/api/public-audio/{filename}"}

    @router.get("/api/public-audio/{filename}")
    async def public_audio_file(filename: str):
        if not _AUDIO_FILENAME_RE.match(filename):
            raise HTTPException(404, "Not found")
        path = os.path.join(PUBLIC_AUDIO_DIR, filename)
        if not os.path.isfile(path):
            raise HTTPException(404, "Not found")
        return FileResponse(path, media_type="audio/wav")

    # ------------------------------------------------------------------
    # Free generation (HuggingFace-backed text tools: posts, scripts,
    # emails, translation, summaries)
    # ------------------------------------------------------------------

    @router.post("/api/generate/text")
    async def generate_text(body: GenerateTextRequest):
        prompt = body.prompt.strip()
        if not prompt:
            raise HTTPException(400, "prompt is required")
        template = TEXT_TASK_PROMPTS.get(body.task)
        if not template:
            raise HTTPException(400, f"Unknown task '{body.task}'")

        if not body.ad_token:
            raise HTTPException(400, "ad_token is required — watch the ads first")
        _spend_ad_token(body.ad_token, "text")

        hf_token = os.getenv("HUGGINGFACE_TOKEN", "")
        if not hf_token:
            return {"ok": False, "status": "placeholder", "message": NO_TOKEN_MESSAGE}

        instruction = template.format(prompt=prompt)
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    TEXT_INFERENCE_URL,
                    headers={"Authorization": f"Bearer {hf_token}"},
                    json={
                        "model": TEXT_MODEL,
                        "messages": [{"role": "user", "content": instruction}],
                        "max_tokens": 400,
                    },
                )
            if resp.status_code != 200:
                logger.warning("HuggingFace text generation failed: %s %s", resp.status_code, resp.text[:200])
                return {"ok": False, "status": "placeholder", "message": NO_TOKEN_MESSAGE}
            data = resp.json()
            generated = data["choices"][0]["message"]["content"].strip()
            if not generated:
                return {"ok": False, "status": "placeholder", "message": NO_TOKEN_MESSAGE}
        except (httpx.HTTPError, ValueError, KeyError, IndexError) as e:
            logger.warning("HuggingFace text generation error: %s", e)
            return {"ok": False, "status": "placeholder", "message": NO_TOKEN_MESSAGE}

        return {"ok": True, "text": generated}

    # ------------------------------------------------------------------
    # Free generation (HuggingFace-backed text-to-video, with polling —
    # generation can take minutes, far longer than one HTTP request should
    # block for, so the ad token is spent once up front and the client polls
    # the job id afterward)
    # ------------------------------------------------------------------

    def _set_video_job(job_id: str, **fields) -> None:
        db = SessionLocal()
        try:
            row = db.query(VideoJob).filter(VideoJob.id == job_id).first()
            if not row:
                return
            for key, value in fields.items():
                setattr(row, key, value)
            db.commit()
        finally:
            db.close()

    async def _run_video_job(job_id: str, prompt: str) -> None:
        hf_token = os.getenv("HUGGINGFACE_TOKEN", "")
        if not hf_token:
            _set_video_job(job_id, status="failed", message=NO_TOKEN_MESSAGE)
            return

        for url in VIDEO_INFERENCE_URLS:
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    resp = await client.post(
                        url,
                        headers={"Authorization": f"Bearer {hf_token}"},
                        json={"inputs": prompt},
                    )
                if resp.status_code == 503:
                    # Model loading — HF's legacy convention: wait the estimated
                    # time and retry this same model once before moving on.
                    wait_for = min(resp.json().get("estimated_time", 20), 60)
                    await asyncio.sleep(wait_for)
                    async with httpx.AsyncClient(timeout=120) as client:
                        resp = await client.post(
                            url,
                            headers={"Authorization": f"Bearer {hf_token}"},
                            json={"inputs": prompt},
                        )
                if resp.status_code == 200 and resp.headers.get("content-type", "").startswith("video/"):
                    filename = f"{uuid.uuid4().hex}.mp4"
                    with open(os.path.join(PUBLIC_VIDEO_DIR, filename), "wb") as f:
                        f.write(resp.content)
                    _set_video_job(job_id, status="done", video_url=f"/api/public-video/{filename}")
                    return
                logger.warning("HuggingFace video generation failed for %s: %s %s", url, resp.status_code, resp.text[:200])
            except httpx.HTTPError as e:
                logger.warning("HuggingFace video request error for %s: %s", url, e)

        _set_video_job(job_id, status="failed", message=NO_VIDEO_MESSAGE)

    @router.post("/api/generate/video")
    async def generate_video(body: GenerateVideoRequest, background_tasks: BackgroundTasks):
        prompt = body.prompt.strip()
        if not prompt:
            raise HTTPException(400, "prompt is required")
        if body.duration not in ("video_5s", "video_10s", "video_25s"):
            raise HTTPException(400, f"Unknown duration '{body.duration}'")

        if not body.ad_token:
            raise HTTPException(400, "ad_token is required — watch the ads first")
        _spend_ad_token(body.ad_token, body.duration)

        job_id = uuid.uuid4().hex
        db = SessionLocal()
        try:
            db.add(VideoJob(id=job_id, prompt=prompt, duration=body.duration, status="processing"))
            db.commit()
        finally:
            db.close()

        background_tasks.add_task(_run_video_job, job_id, prompt)
        return {"ok": True, "status": "processing", "job_id": job_id, "message": VIDEO_PROCESSING_MESSAGE}

    @router.get("/api/generate/video/{job_id}")
    async def generate_video_status(job_id: str):
        db = SessionLocal()
        try:
            row = db.query(VideoJob).filter(VideoJob.id == job_id).first()
        finally:
            db.close()
        if not row:
            raise HTTPException(404, "Unknown job")
        return {"ok": row.status != "failed", "status": row.status, "video_url": row.video_url, "message": row.message}

    @router.get("/api/public-video/{filename}")
    async def public_video_file(filename: str):
        if not _VIDEO_FILENAME_RE.match(filename):
            raise HTTPException(404, "Not found")
        path = os.path.join(PUBLIC_VIDEO_DIR, filename)
        if not os.path.isfile(path):
            raise HTTPException(404, "Not found")
        return FileResponse(path, media_type="video/mp4")

    # ------------------------------------------------------------------
    # "Notify me" signup for video (not connected to a model yet)
    # ------------------------------------------------------------------

    @router.post("/api/notify/signup")
    async def notify_signup(body: SignupRequest):
        email = body.email.strip().lower()
        if not _EMAIL_RE.match(email):
            raise HTTPException(400, "Invalid email")
        if body.feature not in ("video",):
            raise HTTPException(400, "Invalid feature")
        db = SessionLocal()
        try:
            existing = (
                db.query(EmailSignup)
                .filter(EmailSignup.email == email, EmailSignup.feature == body.feature)
                .first()
            )
            if not existing:
                db.add(EmailSignup(id=uuid.uuid4().hex, email=email, feature=body.feature))
                db.commit()
        finally:
            db.close()
        return {"ok": True}

    # ------------------------------------------------------------------
    # Transparency / impact page (read endpoints — start empty/zero;
    # numbers only change through the admin endpoint below)
    # ------------------------------------------------------------------

    @router.get("/api/impact/stats")
    async def impact_stats():
        db = SessionLocal()
        try:
            rows = {r.key: r.value for r in db.query(ImpactStat).all()}
        finally:
            db.close()
        return {key: rows.get(key, 0) for key in IMPACT_STAT_KEYS}

    @router.get("/api/impact/projects")
    async def impact_projects():
        db = SessionLocal()
        try:
            rows = (
                db.query(ImpactProject)
                .filter(ImpactProject.is_active == True)  # noqa: E712
                .order_by(ImpactProject.sort_order, ImpactProject.created_at)
                .all()
            )
            return [
                {
                    "id": r.id,
                    "name": r.name,
                    "icon": r.icon or "",
                    "goal_usd": r.goal_usd,
                    "raised_usd": r.raised_usd,
                }
                for r in rows
            ]
        finally:
            db.close()

    @router.get("/api/impact/feed")
    async def impact_feed(limit: int = 50):
        db = SessionLocal()
        try:
            rows = (
                db.query(ImpactFeedEntry)
                .order_by(ImpactFeedEntry.occurred_at.desc())
                .limit(min(max(limit, 1), 200))
                .all()
            )
            return [
                {
                    "id": r.id,
                    "occurred_at": r.occurred_at.isoformat(),
                    "amount_usd": r.amount_usd,
                    "description": r.description,
                }
                for r in rows
            ]
        finally:
            db.close()

    @router.post("/api/admin/update-stats")
    async def admin_update_stats(body: ImpactStatsUpdate, x_admin_key: Optional[str] = Header(default=None)):
        _require_admin_key(x_admin_key)
        db = SessionLocal()
        try:
            if body.stats:
                for key, value in body.stats.items():
                    if key not in IMPACT_STAT_KEYS:
                        continue
                    row = db.query(ImpactStat).filter(ImpactStat.key == key).first()
                    if row:
                        row.value = int(value)
                    else:
                        db.add(ImpactStat(key=key, value=int(value)))

            if body.project:
                p = body.project
                pid = p.get("id") or uuid.uuid4().hex
                row = db.query(ImpactProject).filter(ImpactProject.id == pid).first()
                if not row:
                    row = ImpactProject(id=pid, name=p.get("name", "Untitled"))
                    db.add(row)
                row.name = p.get("name", row.name)
                row.icon = p.get("icon", row.icon)
                row.goal_usd = int(p.get("goal_usd", row.goal_usd or 0))
                row.raised_usd = int(p.get("raised_usd", row.raised_usd or 0))
                row.is_active = bool(p.get("is_active", True))
                row.sort_order = int(p.get("sort_order", row.sort_order or 0))

            if body.feed_entry:
                f = body.feed_entry
                occurred_at = f.get("occurred_at")
                db.add(ImpactFeedEntry(
                    id=uuid.uuid4().hex,
                    occurred_at=datetime.fromisoformat(occurred_at) if occurred_at else utcnow_naive(),
                    amount_usd=f.get("amount_usd"),
                    description=f.get("description", ""),
                ))

            db.commit()
        finally:
            db.close()
        return {"ok": True}

    return router
