from __future__ import annotations

import logging
import re
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
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_TEMPORARY_PASSWORD_LENGTH = 16
_TEMPORARY_PASSWORD_SPECIALS = "!@#$%*-_"


class UserUpdateRequest(BaseModel):
    loginId: str = Field(max_length=100)
    userName: str = Field(max_length=200)
    email: str = Field(max_length=300)
    roleCode: str = Field(max_length=30)
    useYn: str = Field(max_length=3)
    model_config = ConfigDict(extra="forbid")


class UserCreateRequest(BaseModel):
    loginId: str = Field(max_length=100)
    userName: str = Field(max_length=200)
    email: str = Field(max_length=300)
    roleCode: str = Field(default="USER", max_length=30)
    useYn: str = Field(default="Y", max_length=3)
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


def _oracle_error_code(exc: Exception) -> int | None:
    if not getattr(exc, "args", None):
        return None
    return getattr(exc.args[0], "code", None)


def _normalize_use_yn(value: str, *, allow_all: bool = False) -> str:
    normalized = str(value or "").strip().upper()
    allowed = {"Y", "N"}
    if allow_all:
        allowed.add("ALL")
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail="useYn must be Y, N, or ALL.")
    return normalized


def _temporary_password(length: int = _TEMPORARY_PASSWORD_LENGTH) -> str:
    alphabet = string.ascii_letters + string.digits + _TEMPORARY_PASSWORD_SPECIALS
    random_part = "".join(secrets.choice(alphabet) for _ in range(max(8, length - 4)))
    return f"Aa1!{random_part}"


def _password_policy(*, existing_sessions_revoked: bool) -> dict[str, Any]:
    return {
        "length": _TEMPORARY_PASSWORD_LENGTH,
        "requiredCharacterTypes": ["uppercase", "lowercase", "digit", "special"],
        "allowedSpecialCharacters": _TEMPORARY_PASSWORD_SPECIALS,
        "existingSessionsRevoked": existing_sessions_revoked,
    }


def _validated_user_values(
    login_id_value: str,
    user_name_value: str,
    email_value: str,
    role_code_value: str,
    use_yn_value: str,
) -> tuple[str, str, str, str, str]:
    login_id = login_id_value.strip()
    user_name = user_name_value.strip()
    email = email_value.strip().lower()
    role_code = role_code_value.strip().upper()
    use_yn = _normalize_use_yn(use_yn_value)
    if not login_id:
        raise HTTPException(status_code=400, detail="Login ID is required.")
    if not user_name:
        raise HTTPException(status_code=400, detail="User name is required.")
    if not _EMAIL_PATTERN.fullmatch(email):
        raise HTTPException(status_code=400, detail="A valid email address is required.")
    if role_code not in {"USER", "ADMIN"}:
        raise HTTPException(status_code=400, detail="roleCode must be USER or ADMIN.")
    return login_id, user_name, email, role_code, use_yn


@router.post("")
def create_user(payload: UserCreateRequest):
    login_id, user_name, email, role_code, use_yn = _validated_user_values(
        payload.loginId,
        payload.userName,
        payload.email,
        payload.roleCode,
        payload.useYn,
    )
    temporary_password = _temporary_password()
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ADMIN_USER_TABLE_LOCK"))
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_CREATE_DUPLICATE_COUNT"),
            {"loginId": login_id, "email": email},
        )
        if int(cursor.fetchone()[0] or 0) > 0:
            raise HTTPException(
                status_code=409,
                detail="Login ID or email is already used by another user.",
            )

        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_INSERT"),
            {
                "loginId": login_id,
                "userName": user_name,
                "email": email,
                "passwordHash": hash_password(temporary_password),
                "roleCode": role_code,
                "useYn": use_yn,
            },
        )
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_ID_BY_LOGIN"),
            {"loginId": login_id},
        )
        row = cursor.fetchone()
        if not row:
            raise RuntimeError("Created user could not be reloaded.")
        user_id = int(row[0])
        conn.commit()
        return {
            "status": "success",
            "message": "User created with a temporary password.",
            "data": {
                "userId": user_id,
                "loginId": login_id,
                "userName": user_name,
                "email": email,
                "roleCode": role_code,
                "useYn": use_yn,
                "passwordChangeYn": "N",
                "temporaryPassword": temporary_password,
                "passwordPolicy": _password_policy(existing_sessions_revoked=False),
            },
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Administrator user creation failed.")
        raise HTTPException(status_code=500, detail="User could not be created.") from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


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
    login_id, user_name, email, role_code, use_yn = _validated_user_values(
        payload.loginId,
        payload.userName,
        payload.email,
        payload.roleCode,
        payload.useYn,
    )
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
            SqlLoader.get_sql("ADMIN_USER_DUPLICATE_COUNT"),
            {"loginId": login_id, "email": email, "userId": user_id},
        )
        if int(cursor.fetchone()[0] or 0) > 0:
            raise HTTPException(
                status_code=409,
                detail="Login ID or email is already used by another user.",
            )

        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_UPDATE"),
            {
                "loginId": login_id,
                "userName": user_name,
                "email": email,
                "roleCode": role_code,
                "useYn": use_yn,
                "userId": user_id,
            },
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
            "data": {
                "userId": user_id,
                "loginId": login_id,
                "userName": user_name,
                "email": email,
                "roleCode": role_code,
                "useYn": use_yn,
            },
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


@router.delete("/{user_id}")
def delete_user(user_id: int, request: Request):
    actor_user_id = get_request_user_id(request)
    if actor_user_id == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")

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

        deletes_active_admin = (
            str(current_row[0] or "").strip().upper() == "ADMIN"
            and str(current_row[1] or "").strip().upper() == "Y"
        )
        if deletes_active_admin:
            cursor.execute(SqlLoader.get_sql("ADMIN_ACTIVE_ADMIN_COUNT"))
            active_admin_count = int(cursor.fetchone()[0] or 0)
            if active_admin_count <= 1:
                raise HTTPException(
                    status_code=409,
                    detail="At least one active administrator is required.",
                )

        cursor.execute(SqlLoader.get_sql("ADMIN_USER_DELETE"), {"userId": user_id})
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="User was not found.")
        conn.commit()
        return {
            "status": "success",
            "message": "User deleted.",
            "data": {"userId": user_id},
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        if _oracle_error_code(exc) == 2292:
            raise HTTPException(
                status_code=409,
                detail="User is referenced by business history and cannot be deleted. Disable the user instead.",
            ) from exc
        logger.exception("Administrator user deletion failed.")
        raise HTTPException(status_code=500, detail="User could not be deleted.") from exc
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
            SqlLoader.get_sql("ADMIN_USER_IDENTITY"),
            {"userId": user_id},
        )
        identity_row = cursor.fetchone()
        if not identity_row:
            raise HTTPException(status_code=404, detail="User was not found.")
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_SESSION_REVOKE"),
            {"userId": user_id},
        )
        conn.commit()
        return {
            "status": "success",
            "message": "Temporary password created.",
            "data": {
                "userId": user_id,
                "loginId": identity_row[0],
                "userName": identity_row[1],
                "temporaryPassword": temporary_password,
                "passwordChangeYn": "N",
                "passwordPolicy": _password_policy(existing_sessions_revoked=True),
            },
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
