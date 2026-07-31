from __future__ import annotations

import logging
import secrets
import string
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.auth_context import get_request_user_id, require_admin_role
from backend.database import get_db_connection
from backend.database_helper import SqlLoader
from backend.passwords import hash_password


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin_role)])


class UserUpdateRequest(BaseModel):
    roleCode: str = Field(max_length=30)
    useYn: str = Field(max_length=3)
    model_config = ConfigDict(extra="forbid")


def _serialize(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _camel_key(value: str) -> str:
    parts = str(value or "").lower().split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _rows(cursor) -> list[dict[str, Any]]:
    columns = [description[0] for description in cursor.description or []]
    return [
        {_camel_key(column): _serialize(value) for column, value in zip(columns, row)}
        for row in cursor.fetchall()
    ]


def _normalize_use_yn(value: str, *, allow_all: bool = False) -> str:
    normalized = str(value or "").strip().upper()
    allowed = {"Y", "N"}
    if allow_all:
        allowed.add("ALL")
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail="useYn must be Y, N, or ALL.")
    return normalized


def _temporary_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%*-_"
    random_part = "".join(secrets.choice(alphabet) for _ in range(max(8, length - 4)))
    return f"Aa1!{random_part}"


@router.get("")
def list_users(
    keyword: str = Query("", max_length=200),
    useYn: str = Query("ALL"),
    limit: int = Query(100, ge=1, le=500),
):
    normalized_keyword = keyword.strip().upper()
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_LIST"),
            {
                "keyword": f"%{normalized_keyword}%" if normalized_keyword else None,
                "useYn": _normalize_use_yn(useYn, allow_all=True),
                "limit": limit,
            },
        )
        data = _rows(cursor)
        return {"status": "success", "data": data, "total": len(data)}
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.patch("/{user_id}")
def update_user(user_id: int, payload: UserUpdateRequest, request: Request):
    actor_user_id = get_request_user_id(request)
    role_code = payload.roleCode.strip().upper()
    use_yn = _normalize_use_yn(payload.useYn)
    if role_code not in {"USER", "ADMIN"}:
        raise HTTPException(status_code=400, detail="roleCode must be USER or ADMIN.")
    if actor_user_id == user_id and (role_code != "ADMIN" or use_yn != "Y"):
        raise HTTPException(status_code=400, detail="You cannot remove your own active administrator access.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ADMIN_USER_TABLE_LOCK"))
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_ROLE_STATUS"),
            {"userId": user_id},
        )
        current_row = cursor.fetchone()
        if not current_row:
            raise HTTPException(status_code=404, detail="User was not found.")

        removes_active_admin = (
            str(current_row[0] or "").strip().upper() == "ADMIN"
            and str(current_row[1] or "").strip().upper() == "Y"
            and (role_code != "ADMIN" or use_yn != "Y")
        )
        if removes_active_admin:
            cursor.execute(SqlLoader.get_sql("ADMIN_ACTIVE_ADMIN_COUNT"))
            active_admin_count = int(cursor.fetchone()[0] or 0)
            if active_admin_count <= 1:
                raise HTTPException(
                    status_code=409,
                    detail="At least one active administrator is required.",
                )

        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_UPDATE"),
            {"roleCode": role_code, "useYn": use_yn, "userId": user_id},
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="User was not found.")
        if use_yn == "N":
            cursor.execute(
                SqlLoader.get_sql("ADMIN_USER_SESSION_REVOKE"),
                {"userId": user_id},
            )
        conn.commit()
        return {
            "status": "success",
            "data": {"userId": user_id, "roleCode": role_code, "useYn": use_yn},
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Administrator user update failed.")
        raise HTTPException(status_code=500, detail="User could not be updated.") from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/{user_id}/reset-password")
def reset_password(user_id: int):
    temporary_password = _temporary_password()
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_PASSWORD_RESET"),
            {"passwordHash": hash_password(temporary_password), "userId": user_id},
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="User was not found.")
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_SESSION_REVOKE"),
            {"userId": user_id},
        )
        conn.commit()
        return {
            "status": "success",
            "message": "Temporary password created.",
            "data": {"userId": user_id, "temporaryPassword": temporary_password},
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Administrator password reset failed.")
        raise HTTPException(status_code=500, detail="Password could not be reset.") from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
