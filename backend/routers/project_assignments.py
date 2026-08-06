from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

import oracledb
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.auth_context import get_request_user_id, require_admin_role
from backend.database import get_db_connection
from backend.database_helper import SqlLoader


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin_role)])
_PARTICIPATION_TYPES = {"LEAD", "CONSORTIUM", "SUBCONTRACT"}
_ALLOCATION_TYPES = {"MONTHLY", "WEEKLY"}
_WEEKDAYS = {"MON", "TUE", "WED", "THU", "FRI"}
_MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_MAX_AMOUNT = 999_999_999_999_999_999


class CompanyWriteRequest(BaseModel):
    companyName: str = Field(max_length=200)
    participationTypeCode: str = Field(max_length=30)
    shareRate: Decimal = Field(default=Decimal("0"), ge=0, le=100, decimal_places=2)
    note: str = Field(default="", max_length=1000)
    model_config = ConfigDict(extra="forbid")


class MonthlyAllocation(BaseModel):
    month: str = Field(max_length=7)
    mm: Decimal = Field(ge=0, le=1, decimal_places=2)
    model_config = ConfigDict(extra="forbid")


class AssignmentWriteRequest(BaseModel):
    employeeUserId: int = Field(gt=0)
    projectCompanyId: int | None = Field(default=None, gt=0)
    assignmentStartDate: date
    assignmentEndDate: date
    allocationTypeCode: str = Field(default="MONTHLY", max_length=30)
    defaultMm: Decimal = Field(default=Decimal("1"), ge=0, le=1, decimal_places=2)
    weeklyDayCodes: list[str] = Field(default_factory=list, max_length=5)
    monthlyAllocations: list[MonthlyAllocation] = Field(default_factory=list, max_length=240)
    costUnitPrice: int = Field(default=0, ge=0, le=_MAX_AMOUNT)
    salesUnitPrice: int = Field(default=0, ge=0, le=_MAX_AMOUNT)
    note: str = Field(default="", max_length=2000)
    model_config = ConfigDict(extra="forbid")


def _serialize(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if hasattr(value, "read"):
        return value.read()
    return value


def _camel_key(value: str) -> str:
    parts = str(value or "").lower().split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _rows(cursor) -> list[dict[str, Any]]:
    columns = [item[0] for item in cursor.description or []]
    result = []
    for row in cursor.fetchall():
        item = {_camel_key(column): _serialize(value) for column, value in zip(columns, row)}
        if "monthlyAllocationJson" in item:
            raw_allocations = item.pop("monthlyAllocationJson", None)
            item["monthlyAllocations"] = json.loads(raw_allocations) if raw_allocations else []
        result.append(item)
    return result


def _current_row(cursor) -> dict[str, Any]:
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="대상을 찾을 수 없습니다.")
    columns = [item[0] for item in cursor.description or []]
    return {_camel_key(column): _serialize(value) for column, value in zip(columns, row)}


def _company_params(payload: CompanyWriteRequest) -> dict[str, Any]:
    company_name = payload.companyName.strip()
    type_code = payload.participationTypeCode.strip().upper()
    if not company_name:
        raise HTTPException(status_code=400, detail="회사명을 입력해 주세요.")
    if type_code not in _PARTICIPATION_TYPES:
        raise HTTPException(status_code=400, detail="지원하지 않는 참여유형입니다.")
    return {
        "companyName": company_name,
        "participationTypeCode": type_code,
        "shareRate": payload.shareRate,
        "note": payload.note.strip() or None,
    }


def _assignment_params(payload: AssignmentWriteRequest) -> dict[str, Any]:
    if payload.assignmentStartDate > payload.assignmentEndDate:
        raise HTTPException(status_code=400, detail="투입 종료일은 시작일보다 빠를 수 없습니다.")
    allocation_type = payload.allocationTypeCode.strip().upper()
    if allocation_type not in _ALLOCATION_TYPES:
        raise HTTPException(status_code=400, detail="지원하지 않는 배분 방식입니다.")
    weekdays = []
    for value in payload.weeklyDayCodes:
        code = str(value).strip().upper()
        if code not in _WEEKDAYS:
            raise HTTPException(status_code=400, detail="지원하지 않는 투입 요일입니다.")
        if code not in weekdays:
            weekdays.append(code)
    if allocation_type == "WEEKLY" and not weekdays:
        raise HTTPException(status_code=400, detail="주간 배분은 투입 요일을 선택해야 합니다.")

    allocations = []
    seen_months = set()
    for item in sorted(payload.monthlyAllocations, key=lambda value: value.month):
        if not _MONTH_PATTERN.fullmatch(item.month) or item.month in seen_months:
            raise HTTPException(status_code=400, detail="월별 배분의 연월 값을 확인해 주세요.")
        if not (payload.assignmentStartDate.strftime("%Y-%m") <= item.month <= payload.assignmentEndDate.strftime("%Y-%m")):
            raise HTTPException(status_code=400, detail="월별 배분은 투입기간 안에서만 설정할 수 있습니다.")
        seen_months.add(item.month)
        allocations.append({"month": item.month, "mm": float(item.mm)})
    if not allocations:
        raise HTTPException(status_code=400, detail="월별 M/M 배분을 한 건 이상 입력해 주세요.")
    total_mm = sum((Decimal(str(item["mm"])) for item in allocations), Decimal("0"))
    total_cost = (total_mm * payload.costUnitPrice).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    total_sales = (total_mm * payload.salesUnitPrice).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return {
        "employeeUserId": payload.employeeUserId,
        "projectCompanyId": payload.projectCompanyId,
        "assignmentStartDate": payload.assignmentStartDate,
        "assignmentEndDate": payload.assignmentEndDate,
        "allocationTypeCode": allocation_type,
        "defaultMm": payload.defaultMm,
        "weeklyDayCodes": ",".join(weekdays) if weekdays else None,
        "monthlyAllocationJson": json.dumps(allocations, ensure_ascii=False, separators=(",", ":")),
        "totalMm": total_mm,
        "costUnitPrice": payload.costUnitPrice,
        "salesUnitPrice": payload.salesUnitPrice,
        "totalCostAmount": int(total_cost),
        "totalSalesAmount": int(total_sales),
        "operatingProfit": int(total_sales - total_cost),
        "note": payload.note.strip() or None,
    }


def _ensure_company(cursor, project_id: int, company_id: int | None) -> None:
    if not company_id:
        return
    cursor.execute(
        SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_BELONGS"),
        {"projectId": project_id, "projectCompanyId": company_id},
    )
    if int(cursor.fetchone()[0] or 0) <= 0:
        raise HTTPException(status_code=400, detail="선택한 참여회사가 프로젝트에 속하지 않습니다.")


def _ensure_company_share(cursor, project_id: int, company_id: int | None, share_rate: Decimal) -> None:
    cursor.execute(
        SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_OTHER_SHARE"),
        {"projectId": project_id, "projectCompanyId": company_id},
    )
    if Decimal(str(cursor.fetchone()[0] or 0)) + share_rate > 100:
        raise HTTPException(status_code=400, detail="참여회사 비중 합계는 100%를 초과할 수 없습니다.")


@router.get("/references")
def references():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_REFERENCE_PROJECTS"))
        projects = _rows(cursor)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_REFERENCE_USERS"))
        users = _rows(cursor)
        return {"status": "success", "data": {"projects": projects, "users": users}}
    finally:
        cursor.close()
        conn.close()


@router.get("")
def project_assignment_data(projectId: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_PROJECT"), {"projectId": projectId})
        project = _current_row(cursor)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_LIST"), {"projectId": projectId})
        companies = _rows(cursor)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_LIST"), {"projectId": projectId})
        assignments = _rows(cursor)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_SUMMARY"), {"projectId": projectId})
        summary = _current_row(cursor)
        return {"status": "success", "data": {"project": project, "companies": companies, "assignments": assignments, "summary": summary}}
    finally:
        cursor.close()
        conn.close()


@router.post("/{project_id}/companies")
def create_company(project_id: int, payload: CompanyWriteRequest, request: Request):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        _ensure_company_share(cursor, project_id, None, payload.shareRate)
        output = cursor.var(oracledb.DB_TYPE_NUMBER)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_INSERT"), {**_company_params(payload), "projectId": project_id, "userId": get_request_user_id(request), "projectCompanyIdOut": output})
        conn.commit()
        value = output.getvalue()
        return {"status": "success", "data": {"projectCompanyId": int(value[0] if isinstance(value, list) else value)}}
    except Exception as exc:
        conn.rollback()
        if isinstance(exc, HTTPException):
            raise
        logger.exception("Project company creation failed.")
        raise HTTPException(status_code=500, detail="참여회사를 저장하지 못했습니다.") from exc
    finally:
        cursor.close()
        conn.close()


@router.put("/{project_id}/companies/{company_id}")
def update_company(project_id: int, company_id: int, payload: CompanyWriteRequest, request: Request):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        _ensure_company_share(cursor, project_id, company_id, payload.shareRate)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_UPDATE"), {**_company_params(payload), "projectId": project_id, "projectCompanyId": company_id, "userId": get_request_user_id(request)})
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="참여회사를 찾을 수 없습니다.")
        conn.commit()
        return {"status": "success"}
    except Exception as exc:
        conn.rollback()
        if isinstance(exc, HTTPException):
            raise
        logger.exception("Project company update failed.")
        raise HTTPException(status_code=500, detail="참여회사를 저장하지 못했습니다.") from exc
    finally:
        cursor.close()
        conn.close()


@router.delete("/{project_id}/companies/{company_id}")
def delete_company(project_id: int, company_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_DELETE"), {"projectId": project_id, "projectCompanyId": company_id})
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="참여회사를 찾을 수 없습니다.")
        conn.commit()
        return {"status": "success"}
    except Exception as exc:
        conn.rollback()
        if isinstance(exc, HTTPException):
            raise
        logger.exception("Project company deletion failed.")
        raise HTTPException(status_code=409, detail="투입인력이 연결된 참여회사는 삭제할 수 없습니다.") from exc
    finally:
        cursor.close()
        conn.close()


def _save_assignment(project_id: int, assignment_id: int | None, payload: AssignmentWriteRequest, request: Request):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        params = _assignment_params(payload)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_PROJECT"), {"projectId": project_id})
        project = _current_row(cursor)
        if (
            payload.assignmentStartDate.isoformat() < project["projectStartDate"]
            or payload.assignmentEndDate.isoformat() > project["projectEndDate"]
        ):
            raise HTTPException(status_code=400, detail="투입기간은 프로젝트 기간 안에서 설정해 주세요.")
        _ensure_company(cursor, project_id, payload.projectCompanyId)
        common = {**params, "projectId": project_id, "userId": get_request_user_id(request)}
        cursor.setinputsizes(monthlyAllocationJson=oracledb.DB_TYPE_CLOB)
        if assignment_id:
            cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_UPDATE"), {**common, "assignmentId": assignment_id})
            if cursor.rowcount <= 0:
                raise HTTPException(status_code=404, detail="투입정보를 찾을 수 없습니다.")
        else:
            output = cursor.var(oracledb.DB_TYPE_NUMBER)
            cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_INSERT"), {**common, "assignmentIdOut": output})
            value = output.getvalue()
            assignment_id = int(value[0] if isinstance(value, list) else value)
        conn.commit()
        return {"status": "success", "data": {"assignmentId": assignment_id}}
    except Exception as exc:
        conn.rollback()
        if isinstance(exc, HTTPException):
            raise
        logger.exception("Project assignment save failed.")
        raise HTTPException(status_code=500, detail="투입인력 정보를 저장하지 못했습니다.") from exc
    finally:
        cursor.close()
        conn.close()


@router.post("/{project_id}/assignments")
def create_assignment(project_id: int, payload: AssignmentWriteRequest, request: Request):
    return _save_assignment(project_id, None, payload, request)


@router.put("/{project_id}/assignments/{assignment_id}")
def update_assignment(project_id: int, assignment_id: int, payload: AssignmentWriteRequest, request: Request):
    return _save_assignment(project_id, assignment_id, payload, request)


@router.delete("/{project_id}/assignments/{assignment_id}")
def delete_assignment(project_id: int, assignment_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_DELETE"), {"projectId": project_id, "assignmentId": assignment_id})
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="투입정보를 찾을 수 없습니다.")
        conn.commit()
        return {"status": "success"}
    except HTTPException:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()
