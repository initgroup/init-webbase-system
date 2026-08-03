from __future__ import annotations

import logging
import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request, Response

from backend.auth_context import authenticate_request
from backend.database import get_db_connection
from backend.database_helper import SqlLoader


router = APIRouter()
logger = logging.getLogger(__name__)


def _serialize(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "read"):
        return value.read()
    return value


def _safe_file_name(value: Any) -> str:
    file_name = Path(str(value or "attachment")).name
    file_name = re.sub(r"[\x00-\x1f\x7f]+", "_", file_name).strip()
    return file_name[:500] or "attachment"


def _notice_payload(row) -> dict[str, Any]:
    return {
        "noticeId": int(row[0]),
        "noticeType": row[1] or "INFO",
        "title": row[2],
        "content": _serialize(row[3]) or "",
        "postStartAt": _serialize(row[4]),
        "postEndAt": _serialize(row[5]),
        "pinYn": row[6] or "N",
        "sortOrder": int(row[7] or 0),
        "fileCount": int(row[8] or 0),
        "createdAt": _serialize(row[9]),
    }


def _file_payload(row) -> dict[str, Any]:
    return {
        "fileId": int(row[0]),
        "noticeId": int(row[1]),
        "fileName": row[2],
        "contentType": row[3] or "application/octet-stream",
        "fileSize": int(row[4] or 0),
        "sortOrder": int(row[5] or 0),
    }


def _oracle_error_code(exc: Exception) -> int | None:
    if not getattr(exc, "args", None):
        return None
    return getattr(exc.args[0], "code", None)


def _user_growth_payload(row) -> dict[str, Any]:
    return {
        "monthKey": row[0],
        "monthLabel": row[1],
        "userCount": int(row[2] or 0),
    }


def _session_activity_payload(row) -> dict[str, Any]:
    return {
        "dateKey": row[0],
        "dateLabel": row[1],
        "activeUserCount": int(row[2] or 0),
    }


def _notice_type_payload(row) -> dict[str, Any]:
    return {
        "noticeType": row[0] or "INFO",
        "noticeCount": int(row[1] or 0),
    }


def _ai_training_payload(row) -> dict[str, Any]:
    return {
        "trainingRunId": int(row[0]),
        "modelName": row[1],
        "modelVersion": row[2] or "",
        "datasetRowCount": int(row[3] or 0),
        "epochCount": int(row[4] or 0),
        "accuracyScore": float(row[5]) if row[5] is not None else None,
        "lossScore": float(row[6]) if row[6] is not None else None,
        "runAt": _serialize(row[7]),
    }


@router.get("/dashboard")
def dashboard(request: Request):
    user = authenticate_request(request)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("HOME_DASHBOARD_COUNTS"))
        count_row = cursor.fetchone() or (0, 0, 0)
        cursor.execute(SqlLoader.get_sql("HOME_ACTIVE_NOTICES"), {"limit": 20})
        notices = [_notice_payload(row) for row in cursor.fetchall()]
        for notice in notices:
            cursor.execute(
                SqlLoader.get_sql("HOME_NOTICE_FILES"),
                {"noticeId": notice["noticeId"]},
            )
            notice["attachments"] = [_file_payload(row) for row in cursor.fetchall()]

        cursor.execute(SqlLoader.get_sql("HOME_USER_GROWTH_TREND"))
        user_growth = [_user_growth_payload(row) for row in cursor.fetchall()]
        cursor.execute(SqlLoader.get_sql("HOME_SESSION_ACTIVITY_TREND"))
        session_activity = [_session_activity_payload(row) for row in cursor.fetchall()]
        cursor.execute(SqlLoader.get_sql("HOME_NOTICE_TYPE_DISTRIBUTION"))
        notice_types = [_notice_type_payload(row) for row in cursor.fetchall()]

        ai_table_available = True
        ai_summary_row = (0, 0, 0, 0, None)
        ai_training_trend: list[dict[str, Any]] = []
        try:
            cursor.execute(SqlLoader.get_sql("HOME_AI_TRAINING_SUMMARY"))
            ai_summary_row = cursor.fetchone() or ai_summary_row
            cursor.execute(SqlLoader.get_sql("HOME_AI_TRAINING_TREND"), {"limit": 10})
            ai_training_trend = [_ai_training_payload(row) for row in cursor.fetchall()]
        except Exception as exc:
            if _oracle_error_code(exc) != 942:
                raise
            ai_table_available = False
            logger.warning(
                "AI training dashboard table is not installed; "
                "run database/INIT_SYSTEM_ALT.sql."
            )

        return {
            "status": "success",
            "data": {
                "appName": os.getenv("APP_NAME", "INIT Members"),
                "user": user,
                "userCount": int(count_row[0] or 0),
                "activeUserCount": int(count_row[1] or 0),
                "noticeCount": int(count_row[2] or 0),
                "userGrowth": user_growth,
                "sessionActivity": session_activity,
                "noticeTypes": notice_types,
                "aiTraining": {
                    "tableAvailable": ai_table_available,
                    "totalCount": int(ai_summary_row[0] or 0),
                    "completedCount": int(ai_summary_row[1] or 0),
                    "activeCount": int(ai_summary_row[2] or 0),
                    "failedCount": int(ai_summary_row[3] or 0),
                    "averageAccuracy": (
                        float(ai_summary_row[4])
                        if ai_summary_row[4] is not None
                        else None
                    ),
                    "trend": ai_training_trend,
                },
                "notices": notices,
            },
        }
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/notice-files/{file_id}/download")
def download_notice_file(file_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("HOME_NOTICE_FILE_DOWNLOAD"), {"fileId": file_id})
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Attachment was not found.")
        file_name = _safe_file_name(row[2])
        file_data = _serialize(row[5]) or b""
        if isinstance(file_data, str):
            file_data = file_data.encode("utf-8")
        return Response(
            content=file_data,
            media_type=row[3] or "application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename=\"attachment\"; filename*=UTF-8''{quote(file_name)}",
                "X-Content-Type-Options": "nosniff",
            },
        )
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
