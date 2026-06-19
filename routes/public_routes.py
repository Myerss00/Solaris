# routes/public_routes.py
"""Public, unauthenticated routes for the Solaris marketing site:
ad-gated free generation (/api/ads/*, /api/generate/*) and the
transparency page (/api/impact/*). None of these touch the owner/session
auth model — there is no logged-in user here, just anonymous visitors.
"""

import base64
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, model_validator

from core.database import (
    AdRewardToken,
    EmailSignup,
    ImpactFeedEntry,
    ImpactProject,
    ImpactStat,
    SessionLocal,
    utcnow_naive,
)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Friendly placeholder shown whenever generation can't actually run (missing
# token, HF error, network failure). Never surfaces the underlying exception
# to the end user — only this one fixed message.
NO_TOKEN_MESSAGE = "Connecting to the generator... If you're the administrator, add HUGGINGFACE_TOKEN to your .env"

logger = logging.getLogger(__name__)

HF_MODEL = "black-forest-labs/FLUX.1-schnell"
# HuggingFace retired api-inference.huggingface.co in favor of the Inference
# Providers router — the old hostname no longer resolves at all.
HF_INFERENCE_URL = f"https://router.huggingface.co/hf-inference/models/{HF_MODEL}"

# tier -> seconds the client must wait before the ad-reward token verifies
AD_TIERS = {
    "hd": 30,
    "4k": 45,
    "video_5s": 60,
    "video_10s": 90,
    "video_30s": 150,
    "video_60s": 240,
}

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


class SignupRequest(BaseModel):
    email: str
    feature: str  # "video" or "audio"


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
        return {"token": token, "required_seconds": AD_TIERS[body.tier]}

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

    @router.post("/api/generate/image")
    async def generate_image(body: GenerateImageRequest):
        prompt = body.prompt.strip()
        if not prompt:
            raise HTTPException(400, "prompt is required")

        if body.tier != "basic":
            if not body.ad_token:
                raise HTTPException(400, "ad_token is required for this tier")
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

        return {"ok": True, "image_data_url": f"data:{content_type};base64,{image_b64}"}

    # ------------------------------------------------------------------
    # "Notify me" signup for video/audio (not connected to a model yet)
    # ------------------------------------------------------------------

    @router.post("/api/notify/signup")
    async def notify_signup(body: SignupRequest):
        email = body.email.strip().lower()
        if not _EMAIL_RE.match(email):
            raise HTTPException(400, "Invalid email")
        if body.feature not in ("video", "audio"):
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
