from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)


class SqlLoader:
    _query_map: dict[str, str] = {}
    _source_map: dict[str, str] = {}
    _sql_dir = Path(__file__).resolve().parent.parent / "database"
    _section_pattern = re.compile(
        r"(?ms)^-- \[([A-Za-z0-9_]+)\][ \t]*\r?\n(.*?)(?=^-- \[[A-Za-z0-9_]+\][ \t]*\r?$|\Z)"
    )

    @classmethod
    def normalize_loaded_sql(cls, query: str) -> str:
        text = str(query or "").strip()
        if re.match(r"(?is)^\s*(declare|begin)\b", text):
            return re.sub(r"(?m)^\s*/\s*$", "", text).strip()
        text = re.sub(r"(?m)^[ \t]*;[ \t]*(?:\r?\n|$)", "", text).strip()
        return text.rstrip(";").strip()

    @classmethod
    def reload_queries(cls) -> None:
        if not cls._sql_dir.is_dir():
            raise RuntimeError(f"SQL directory was not found: {cls._sql_dir}")

        query_map: dict[str, str] = {}
        source_map: dict[str, str] = {}
        duplicates: list[str] = []
        sql_files = sorted(cls._sql_dir.glob("*.sql"), key=lambda path: path.name.lower())
        for file_path in sql_files:
            content = file_path.read_text(encoding="utf-8")
            for match in cls._section_pattern.finditer(content):
                sql_id = match.group(1).strip()
                if sql_id in query_map:
                    duplicates.append(
                        f"{sql_id} ({source_map[sql_id]}, {file_path.name})"
                    )
                    continue
                query = cls.normalize_loaded_sql(match.group(2))
                if not query:
                    raise RuntimeError(f"SQL ID {sql_id} is empty in {file_path.name}.")
                query_map[sql_id] = query
                source_map[sql_id] = file_path.name

        if duplicates:
            raise RuntimeError("Duplicate SQL IDs were found: " + ", ".join(duplicates))
        if not query_map:
            raise RuntimeError(f"No SQL sections were loaded from {cls._sql_dir}.")

        cls._query_map = query_map
        cls._source_map = source_map
        logger.info("Loaded %s SQL statements from %s files.", len(query_map), len(sql_files))

    @classmethod
    def get_sql(cls, sql_id: str) -> str:
        sql = cls._query_map.get(sql_id)
        if not sql:
            raise ValueError(f"Undefined SQL ID: {sql_id}")
        return sql


SqlLoader.reload_queries()


def execute_query(
    conn,
    sql_id: str,
    params: dict[str, Any] | None = None,
    *,
    is_dml: bool = False,
) -> dict[str, Any]:
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql(sql_id), params or {})
        if is_dml:
            conn.commit()
            return {
                "status": "success",
                "data": [],
                "columns": [],
                "total": max(0, int(cursor.rowcount or 0)),
            }

        columns = [description[0] for description in cursor.description or []]
        rows = cursor.fetchall() if cursor.description else []
        data = [
            {
                column: value.read() if hasattr(value, "read") else value
                for column, value in zip(columns, row)
            }
            for row in rows
        ]
        return {
            "status": "success",
            "data": data,
            "columns": columns,
            "total": len(data),
        }
    except Exception:
        if is_dml:
            conn.rollback()
        logger.exception("SQL execution failed. sql_id=%s", sql_id)
        raise
    finally:
        if cursor:
            cursor.close()
