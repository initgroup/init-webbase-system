from __future__ import annotations

import logging
import re
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.auth_context import (
    get_current_session_token_hash,
    get_request_user_id,
)
from backend.database import get_db_connection
from backend.database_helper import SqlLoader
from backend.passwords import hash_password, verify_password


logger = logging.getLogger(__name__)
router = APIRouter()
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ProfileUpdateRequest(BaseModel):
    userName: str = Field(max_length=200)
    email: str = Field(max_length=300)
    model_config = ConfigDict(extra="forbid")


class PasswordUpdateRequest(BaseModel):
    currentPassword: str = Field(max_length=1024)
    newPassword: str = Field(max_length=1024)
    model_config = ConfigDict(extra="forbid")


def _serialize(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "read"):
        return value.read()
    return value


def _user_payload(row) -> dict[str, Any]:
    return {
        "userId": int(row[0]),
        "loginId": row[1],
        "userName": row[2],
        "email": row[3],
        "roleCode": row[4] or "USER",
        "useYn": row[5],
        "createdAt": _serialize(row[6]),
        "updatedAt": _serialize(row[7]),
    }


def _load_user(cursor, user_id: int):
    cursor.execute(SqlLoader.get_sql("ACCOUNT_USER_DETAIL"), {"userId": user_id})
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Login user was not found.")
    return row


@router.get("/me")
def get_my_account(request: Request):
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        return {"status": "success", "data": _user_payload(_load_user(cursor, user_id))}
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.put("/profile")
def update_profile(payload: ProfileUpdateRequest, request: Request):
    user_id = get_request_user_id(request)
    user_name = payload.userName.strip()
    email = payload.email.strip().lower()
    if not user_name:
        raise HTTPException(status_code=400, detail="User name is required.")
    if len(user_name) > 200:
        raise HTTPException(status_code=400, detail="User name must be 200 characters or less.")
    if not _EMAIL_PATTERN.fullmatch(email):
        raise HTTPException(status_code=400, detail="A valid email address is required.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("ACCOUNT_EMAIL_DUPLICATE_COUNT"),
            {"email": email, "userId": user_id},
        )
        if int(cursor.fetchone()[0] or 0) > 0:
            raise HTTPException(status_code=409, detail="Email is already used by another user.")
        cursor.execute(
            SqlLoader.get_sql("ACCOUNT_PROFILE_UPDATE"),
            {"userName": user_name, "email": email, "userId": user_id},
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="Active login user was not found.")
        user = _user_payload(_load_user(cursor, user_id))
        conn.commit()
        return {"status": "success", "data": user}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Account profile update failed.")
        raise HTTPException(status_code=500, detail="Account profile could not be updated.") from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.put("/password")
def update_password(payload: PasswordUpdateRequest, request: Request):
    user_id = get_request_user_id(request)
    current_session_token_hash = get_current_session_token_hash(request)
    current_password = payload.currentPassword
    new_password = payload.newPassword
    if not current_password:
        raise HTTPException(status_code=400, detail="Current password is required.")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters.")
    if current_password == new_password:
        raise HTTPException(status_code=400, detail="New password must be different from the current password.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ACCOUNT_PASSWORD_HASH"), {"userId": user_id})
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Active login user was not found.")
        if not verify_password(current_password, row[0] or ""):
            raise HTTPException(status_code=400, detail="Current password is not correct.")
        cursor.execute(
            SqlLoader.get_sql("ACCOUNT_PASSWORD_UPDATE"),
            {"passwordHash": hash_password(new_password), "userId": user_id},
        )
        cursor.execute(
            SqlLoader.get_sql("ACCOUNT_REVOKE_OTHER_SESSIONS"),
            {
                "userId": user_id,
                "currentSessionTokenHash": current_session_token_hash,
            },
        )
        conn.commit()
        return {"status": "success", "message": "Password changed."}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Account password update failed.")
        raise HTTPException(status_code=500, detail="Password could not be updated.") from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
