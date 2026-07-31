from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.auth_context import get_request_user_id, require_admin_role
from backend.database import get_db_connection
from backend.database_helper import SqlLoader


logger = logging.getLogger(__name__)
public_router = APIRouter()
admin_router = APIRouter(dependencies=[Depends(require_admin_role)])

DEFAULT_HOMEPAGE_SKIN = "national-intelligence"
ALLOWED_HOMEPAGE_SKINS = {
    "national-intelligence",
    "data-spectrum",
    "public-insight",
}


class SitePreferenceUpdateRequest(BaseModel):
    homepageSkin: str = Field(min_length=1, max_length=50)
    model_config = ConfigDict(extra="forbid")


def _oracle_error_code(exc: Exception) -> int | None:
    if not getattr(exc, "args", None):
        return None
    return getattr(exc.args[0], "code", None)


def _normalize_skin(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in ALLOWED_HOMEPAGE_SKINS else DEFAULT_HOMEPAGE_SKIN


def _read_homepage_skin() -> tuple[str, bool]:
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("SITE_HOMEPAGE_SKIN_GET"))
        row = cursor.fetchone()
        return (_normalize_skin(row[0] if row else None), bool(row))
    except Exception as exc:
        if _oracle_error_code(exc) == 942:
            logger.warning("System settings table is not installed; using the default skin.")
            return (DEFAULT_HOMEPAGE_SKIN, False)
        raise
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@public_router.get("/preferences")
def public_site_preferences():
    try:
        homepage_skin, _ = _read_homepage_skin()
        return {
            "status": "success",
            "data": {"homepageSkin": homepage_skin},
        }
    except Exception as exc:
        logger.exception("Public site preferences could not be loaded.")
        raise HTTPException(
            status_code=500,
            detail="Site preferences could not be loaded.",
        ) from exc


@admin_router.get("")
def get_site_preferences():
    try:
        homepage_skin, configured = _read_homepage_skin()
        return {
            "status": "success",
            "data": {
                "homepageSkin": homepage_skin,
                "configured": configured,
                "supportedHomepageSkins": sorted(ALLOWED_HOMEPAGE_SKINS),
            },
        }
    except Exception as exc:
        logger.exception("Administrator site preferences could not be loaded.")
        raise HTTPException(
            status_code=500,
            detail="Site preferences could not be loaded.",
        ) from exc


@admin_router.put("")
def update_site_preferences(payload: SitePreferenceUpdateRequest, request: Request):
    homepage_skin = str(payload.homepageSkin or "").strip().lower()
    if homepage_skin not in ALLOWED_HOMEPAGE_SKINS:
        raise HTTPException(status_code=400, detail="Unsupported homepage skin.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("SITE_HOMEPAGE_SKIN_UPSERT"),
            {
                "settingValue": homepage_skin,
                "updatedBy": get_request_user_id(request),
            },
        )
        conn.commit()
        return {
            "status": "success",
            "data": {"homepageSkin": homepage_skin, "configured": True},
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Administrator site preferences update failed.")
        detail = (
            "System settings table is not installed. "
            "Run database/INIT_SYSTEM_ALT.sql for an existing database."
            if _oracle_error_code(exc) == 942
            else "Site preferences could not be saved."
        )
        raise HTTPException(status_code=503, detail=detail) from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
