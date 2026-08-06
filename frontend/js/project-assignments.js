(function() {
    "use strict";

    const PAGE_NAME = "project-assignments";
    const TYPE_LABELS = { LEAD: "주관사", CONSORTIUM: "컨소사", SUBCONTRACT: "하도급" };
    const WEEKDAY_CODES = ["MON", "TUE", "WED", "THU", "FRI"];
    let root = null;
    let controller = null;
    let projects = [];
    let employees = [];
    let companies = [];
    let assignments = [];

    function query(selector) { return root?.querySelector(selector) || null; }
    function value(row, ...keys) { return Common.data.pick(row, ...keys); }
    function money(nextValue) { return `${Math.round(Number(nextValue || 0)).toLocaleString("ko-KR")}원`; }
    function number(nextValue) { return Number(nextValue || 0); }
    function option(valueText, text) { return Common.dom.element("option", { value: valueText, text }); }
    function cell(text = "") { return Common.dom.element("td", { text }); }

    function selectedProjectId() { return query("#assignmentProjectSelect").value; }

    function populateReferences() {
        const projectSelect = query("#assignmentProjectSelect");
        projects.forEach((project) => projectSelect.appendChild(option(
            value(project, "projectId", "PROJECT_ID"),
            `${value(project, "projectYear", "PROJECT_YEAR")} · ${value(project, "projectName", "PROJECT_NAME")}`
        )));
        const employeeSelect = query("#assignmentEmployee");
        employeeSelect.replaceChildren(option("", "임직원 선택"));
        employees.forEach((employee) => {
            const employeeNo = value(employee, "employeeNo", "EMPLOYEE_NO");
            const department = value(employee, "departmentName", "DEPARTMENT_NAME") || "부서 미지정";
            employeeSelect.appendChild(option(
                value(employee, "userId", "USER_ID"),
                `${value(employee, "userName", "USER_NAME")} · ${department}${employeeNo ? ` · ${employeeNo}` : ""}`
            ));
        });
    }

    async function loadReferences() {
        const payload = await Common.api.request("/project-assignments/references", {
            signal: controller.signal,
            showLoading: false
        });
        const data = Common.data.get(payload) || {};
        projects = value(data, "projects", "PROJECTS") || [];
        employees = value(data, "users", "USERS") || [];
        populateReferences();
    }

    function renderSummary(summary) {
        const sales = number(value(summary, "totalSalesAmount", "TOTAL_SALES_AMOUNT"));
        const profit = number(value(summary, "operatingProfit", "OPERATING_PROFIT"));
        const contractAmount = number(value(summary, "contractAmountVat", "CONTRACT_AMOUNT_VAT"));
        query("#summaryContractAmount").textContent = money(contractAmount);
        query("#summaryTotalMm").textContent = `${number(value(summary, "totalMm", "TOTAL_MM")).toFixed(2)} M`;
        query("#summarySalesAmount").textContent = money(sales);
        query("#summaryCostAmount").textContent = money(value(summary, "totalCostAmount", "TOTAL_COST_AMOUNT"));
        query("#summaryProfitAmount").textContent = money(profit);
        query("#summaryProfitRate").textContent = sales ? `${(profit / sales * 100).toFixed(1)}%` : "0%";
        query("#summaryCompanyShareRate").textContent = `${number(value(summary, "companyShareRate", "COMPANY_SHARE_RATE")).toFixed(2)}%`;
        query("#summaryCompanyAllocatedAmount").textContent = money(value(summary, "companyAllocatedAmount", "COMPANY_ALLOCATED_AMOUNT"));
        query("#summarySalesContractRate").textContent = contractAmount ? `${(sales / contractAmount * 100).toFixed(1)}%` : "0%";
        query("#assignmentSummary").hidden = false;
    }

    function renderCompanies() {
        const body = query("#projectCompanyTableBody");
        Common.dom.clear(body);
        if (!companies.length) {
            const row = Common.dom.element("tr");
            const empty = cell("등록된 참여회사가 없습니다.");
            empty.colSpan = 7;
            empty.style.textAlign = "center";
            row.appendChild(empty);
            body.appendChild(row);
        }
        companies.forEach((company) => {
            const row = Common.dom.element("tr", { attrs: { tabindex: "0", "data-company-id": String(value(company, "projectCompanyId", "PROJECT_COMPANY_ID")) } });
            row.append(
                cell(value(company, "companyName", "COMPANY_NAME")),
                cell(TYPE_LABELS[value(company, "participationTypeCode", "PARTICIPATION_TYPE_CODE")] || "-"),
                cell(`${number(value(company, "shareRate", "SHARE_RATE")).toFixed(2)}%`),
                cell(money(value(company, "allocatedSalesAmount", "ALLOCATED_SALES_AMOUNT"))),
                cell(money(value(company, "totalCostAmount", "TOTAL_COST_AMOUNT"))),
                cell(money(value(company, "totalSalesAmount", "TOTAL_SALES_AMOUNT"))),
                cell(money(value(company, "operatingProfit", "OPERATING_PROFIT")))
            );
            body.appendChild(row);
        });
        const companySelect = query("#assignmentCompany");
        const selected = companySelect.value;
        companySelect.replaceChildren(option("", "직접 투입/미지정"));
        companies.forEach((company) => companySelect.appendChild(option(
            value(company, "projectCompanyId", "PROJECT_COMPANY_ID"),
            value(company, "companyName", "COMPANY_NAME")
        )));
        companySelect.value = selected;
    }

    function renderAssignments() {
        const body = query("#assignmentTableBody");
        Common.dom.clear(body);
        if (!assignments.length) {
            const row = Common.dom.element("tr");
            const empty = cell("등록된 투입인력이 없습니다.");
            empty.colSpan = 11;
            empty.style.textAlign = "center";
            row.appendChild(empty);
            body.appendChild(row);
        }
        assignments.forEach((assignment) => {
            const row = Common.dom.element("tr", { attrs: { tabindex: "0", "data-assignment-id": String(value(assignment, "assignmentId", "ASSIGNMENT_ID")) } });
            const department = value(assignment, "departmentName", "DEPARTMENT_NAME") || "-";
            const position = value(assignment, "positionName", "POSITION_NAME") || "-";
            row.append(
                cell(value(assignment, "userName", "USER_NAME")),
                cell(`${department} / ${position}`),
                cell(value(assignment, "companyName", "COMPANY_NAME") || "직접 투입"),
                cell(`${value(assignment, "assignmentStartDate", "ASSIGNMENT_START_DATE")} ~ ${value(assignment, "assignmentEndDate", "ASSIGNMENT_END_DATE")}`),
                cell(value(assignment, "allocationTypeCode", "ALLOCATION_TYPE_CODE") === "WEEKLY" ? `매주 ${value(assignment, "weeklyDayCodes", "WEEKLY_DAY_CODES") || ""}` : "월별"),
                cell(`${number(value(assignment, "totalMm", "TOTAL_MM")).toFixed(2)} M`),
                cell(money(value(assignment, "costUnitPrice", "COST_UNIT_PRICE"))),
                cell(money(value(assignment, "salesUnitPrice", "SALES_UNIT_PRICE"))),
                cell(money(value(assignment, "totalCostAmount", "TOTAL_COST_AMOUNT"))),
                cell(money(value(assignment, "totalSalesAmount", "TOTAL_SALES_AMOUNT"))),
                cell(money(value(assignment, "operatingProfit", "OPERATING_PROFIT")))
            );
            body.appendChild(row);
        });
    }

    async function loadProjectData() {
        const projectId = selectedProjectId();
        if (!projectId) {
            ["#assignmentSummary", "#projectCompanyPanel", "#assignmentListPanel", "#assignmentEditorPanel"].forEach((selector) => query(selector).hidden = true);
            return;
        }
        Common.ui.setInlineStatus(query("#assignmentPageStatus"), "프로젝트 투입정보를 불러오고 있습니다.");
        try {
            const payload = await Common.api.request(`/project-assignments?projectId=${encodeURIComponent(projectId)}`, { signal: controller.signal, showLoading: false });
            const data = Common.data.get(payload) || {};
            companies = value(data, "companies", "COMPANIES") || [];
            assignments = value(data, "assignments", "ASSIGNMENTS") || [];
            renderSummary(value(data, "summary", "SUMMARY") || {});
            renderCompanies();
            renderAssignments();
            ["#projectCompanyPanel", "#assignmentListPanel", "#assignmentEditorPanel"].forEach((selector) => query(selector).hidden = false);
            clearCompanyForm();
            clearAssignmentForm();
            Common.ui.setInlineStatus(query("#assignmentPageStatus"), `${assignments.length}명의 투입인력을 조회했습니다.`);
        } catch (error) {
            if (error?.name !== "AbortError") Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message || "투입정보를 불러오지 못했습니다.", "error");
        }
    }

    function clearCompanyForm() {
        query("#projectCompanyForm").reset();
        query("#projectCompanyId").value = "";
        query("#deleteProjectCompanyButton").hidden = true;
    }

    function fillCompanyForm(company) {
        query("#projectCompanyId").value = value(company, "projectCompanyId", "PROJECT_COMPANY_ID");
        query("#projectCompanyName").value = value(company, "companyName", "COMPANY_NAME") || "";
        query("#projectCompanyType").value = value(company, "participationTypeCode", "PARTICIPATION_TYPE_CODE") || "LEAD";
        query("#projectCompanyShareRate").value = value(company, "shareRate", "SHARE_RATE") || 0;
        query("#projectCompanyNote").value = value(company, "note", "NOTE") || "";
        query("#deleteProjectCompanyButton").hidden = false;
    }

    async function saveCompany(event) {
        event.preventDefault();
        if (!event.currentTarget.reportValidity() || !selectedProjectId()) return;
        const id = query("#projectCompanyId").value;
        await Common.api.request(`/project-assignments/${encodeURIComponent(selectedProjectId())}/companies${id ? `/${encodeURIComponent(id)}` : ""}`, {
            method: id ? "PUT" : "POST",
            body: { companyName: query("#projectCompanyName").value.trim(), participationTypeCode: query("#projectCompanyType").value, shareRate: query("#projectCompanyShareRate").value, note: query("#projectCompanyNote").value.trim() },
            signal: controller.signal,
            loadingMessage: "참여회사를 저장하고 있습니다."
        });
        Common.ui.toast("참여회사를 저장했습니다.", "success");
        await loadProjectData();
    }

    async function deleteCompany() {
        const id = query("#projectCompanyId").value;
        if (!id || !(await Common.ui.confirm("선택한 참여회사를 삭제하시겠습니까?", { title: "참여회사 삭제", confirmText: "삭제", danger: true }))) return;
        await Common.api.request(`/project-assignments/${encodeURIComponent(selectedProjectId())}/companies/${encodeURIComponent(id)}`, { method: "DELETE", signal: controller.signal, loadingMessage: "참여회사를 삭제하고 있습니다." });
        await loadProjectData();
    }

    function monthRange(startText, endText) {
        if (!startText || !endText || startText > endText) return [];
        const [startYear, startMonth] = startText.split("-").map(Number);
        const [endYear, endMonth] = endText.split("-").map(Number);
        const result = [];
        for (let cursor = new Date(startYear, startMonth - 1, 1), end = new Date(endYear, endMonth - 1, 1); cursor <= end; cursor.setMonth(cursor.getMonth() + 1)) {
            result.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
        }
        return result;
    }

    function weekdayMm(month, selectedDays) {
        const [year, monthNumber] = month.split("-").map(Number);
        const first = new Date(`${query("#assignmentStartDate").value}T00:00:00`);
        const last = new Date(`${query("#assignmentEndDate").value}T00:00:00`);
        let workdays = 0;
        let assigned = 0;
        for (let date = new Date(year, monthNumber - 1, 1); date.getMonth() === monthNumber - 1; date.setDate(date.getDate() + 1)) {
            if (date.getDay() === 0 || date.getDay() === 6) continue;
            workdays += 1;
            if (date >= first && date <= last && selectedDays.includes(WEEKDAY_CODES[date.getDay() - 1])) assigned += 1;
        }
        return workdays ? Math.round(assigned / workdays * 100) / 100 : 0;
    }

    function monthlyMm(month, defaultMm) {
        const [year, monthNumber] = month.split("-").map(Number);
        const first = new Date(`${query("#assignmentStartDate").value}T00:00:00`);
        const last = new Date(`${query("#assignmentEndDate").value}T00:00:00`);
        let workdays = 0;
        let activeWorkdays = 0;
        for (let date = new Date(year, monthNumber - 1, 1); date.getMonth() === monthNumber - 1; date.setDate(date.getDate() + 1)) {
            if (date.getDay() === 0 || date.getDay() === 6) continue;
            workdays += 1;
            if (date >= first && date <= last) activeWorkdays += 1;
        }
        return workdays ? Math.round(defaultMm * activeWorkdays / workdays * 100) / 100 : 0;
    }

    function renderMonthlyAllocations(allocations) {
        const body = query("#monthlyAllocationBody");
        Common.dom.clear(body);
        allocations.forEach((item) => {
            const row = Common.dom.element("tr", { attrs: { "data-month": item.month } });
            const input = Common.dom.element("input", { className: "input monthly-mm-input", type: "number", value: item.mm, attrs: { min: "0", max: "1", step: "0.01", "aria-label": `${item.month} M/M` } });
            const mmCell = cell(); mmCell.appendChild(input);
            row.append(cell(item.month), mmCell, cell("0원"), cell("0원"), cell("0원"));
            body.appendChild(row);
        });
        updateMonthlyTotals();
    }

    function generateMonthlyAllocations() {
        const months = monthRange(query("#assignmentStartDate").value, query("#assignmentEndDate").value);
        const weekly = query("#assignmentAllocationType").value === "WEEKLY";
        const selectedDays = [...root.querySelectorAll("#assignmentWeekdays input:checked")].map((input) => input.value);
        const defaultMm = number(query("#assignmentDefaultMm").value);
        renderMonthlyAllocations(months.map((month) => ({
            month,
            mm: weekly ? weekdayMm(month, selectedDays) : monthlyMm(month, defaultMm)
        })));
    }

    function currentAllocations() {
        return [...root.querySelectorAll("#monthlyAllocationBody tr")].map((row) => ({ month: row.dataset.month, mm: number(row.querySelector("input").value) }));
    }

    function updateMonthlyTotals() {
        const costUnit = number(query("#assignmentCostUnitPrice").value);
        const salesUnit = number(query("#assignmentSalesUnitPrice").value);
        let totalMm = 0, totalCost = 0, totalSales = 0;
        [...root.querySelectorAll("#monthlyAllocationBody tr")].forEach((row) => {
            const mm = number(row.querySelector("input").value);
            const cost = Math.round(mm * costUnit), sales = Math.round(mm * salesUnit);
            totalMm += mm; totalCost += cost; totalSales += sales;
            row.children[2].textContent = money(cost); row.children[3].textContent = money(sales); row.children[4].textContent = money(sales - cost);
        });
        query("#monthlyTotalMm").textContent = `${totalMm.toFixed(2)} M`;
        query("#monthlyTotalCost").textContent = money(totalCost);
        query("#monthlyTotalSales").textContent = money(totalSales);
        query("#monthlyTotalProfit").textContent = money(totalSales - totalCost);
    }

    function clearAssignmentForm() {
        query("#assignmentForm").reset();
        query("#assignmentId").value = "";
        query("#deleteAssignmentButton").hidden = true;
        query("#assignmentEditorTitle").textContent = "투입인력 등록";
        query("#assignmentWeekdays").hidden = true;
        Common.dom.clear(query("#monthlyAllocationBody"));
        updateMonthlyTotals();
    }

    function fillAssignmentForm(item) {
        query("#assignmentId").value = value(item, "assignmentId", "ASSIGNMENT_ID");
        query("#assignmentEmployee").value = value(item, "userId", "USER_ID");
        query("#assignmentCompany").value = value(item, "projectCompanyId", "PROJECT_COMPANY_ID") || "";
        query("#assignmentStartDate").value = String(value(item, "assignmentStartDate", "ASSIGNMENT_START_DATE")).slice(0, 10);
        query("#assignmentEndDate").value = String(value(item, "assignmentEndDate", "ASSIGNMENT_END_DATE")).slice(0, 10);
        query("#assignmentAllocationType").value = value(item, "allocationTypeCode", "ALLOCATION_TYPE_CODE") || "MONTHLY";
        query("#assignmentDefaultMm").value = String(value(item, "defaultMm", "DEFAULT_MM") ?? 1);
        query("#assignmentCostUnitPrice").value = value(item, "costUnitPrice", "COST_UNIT_PRICE") || 0;
        query("#assignmentSalesUnitPrice").value = value(item, "salesUnitPrice", "SALES_UNIT_PRICE") || 0;
        query("#assignmentNote").value = value(item, "note", "NOTE") || "";
        const weeklyDays = String(value(item, "weeklyDayCodes", "WEEKLY_DAY_CODES") || "").split(",");
        root.querySelectorAll("#assignmentWeekdays input").forEach((input) => input.checked = weeklyDays.includes(input.value));
        query("#assignmentWeekdays").hidden = query("#assignmentAllocationType").value !== "WEEKLY";
        query("#deleteAssignmentButton").hidden = false;
        query("#assignmentEditorTitle").textContent = "투입인력 상세 및 수정";
        renderMonthlyAllocations(value(item, "monthlyAllocations", "MONTHLY_ALLOCATIONS") || []);
    }

    async function saveAssignment(event) {
        event.preventDefault();
        if (!event.currentTarget.reportValidity() || !selectedProjectId()) return;
        const allocations = currentAllocations();
        if (!allocations.length) { Common.ui.setInlineStatus(query("#assignmentEditorStatus"), "월별 배분을 생성해 주세요.", "error"); return; }
        const id = query("#assignmentId").value;
        await Common.api.request(`/project-assignments/${encodeURIComponent(selectedProjectId())}/assignments${id ? `/${encodeURIComponent(id)}` : ""}`, {
            method: id ? "PUT" : "POST",
            body: { employeeUserId: Number(query("#assignmentEmployee").value), projectCompanyId: query("#assignmentCompany").value ? Number(query("#assignmentCompany").value) : null, assignmentStartDate: query("#assignmentStartDate").value, assignmentEndDate: query("#assignmentEndDate").value, allocationTypeCode: query("#assignmentAllocationType").value, defaultMm: query("#assignmentDefaultMm").value, weeklyDayCodes: [...root.querySelectorAll("#assignmentWeekdays input:checked")].map((input) => input.value), monthlyAllocations: allocations, costUnitPrice: query("#assignmentCostUnitPrice").value, salesUnitPrice: query("#assignmentSalesUnitPrice").value, note: query("#assignmentNote").value.trim() },
            signal: controller.signal,
            loadingMessage: "투입인력 정보를 저장하고 있습니다."
        });
        Common.ui.toast("투입인력 정보를 저장했습니다.", "success");
        await loadProjectData();
    }

    async function deleteAssignment() {
        const id = query("#assignmentId").value;
        if (!id || !(await Common.ui.confirm("선택한 투입정보를 삭제하시겠습니까?", { title: "투입인력 삭제", confirmText: "삭제", danger: true }))) return;
        await Common.api.request(`/project-assignments/${encodeURIComponent(selectedProjectId())}/assignments/${encodeURIComponent(id)}`, { method: "DELETE", signal: controller.signal, loadingMessage: "투입정보를 삭제하고 있습니다." });
        await loadProjectData();
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            root = context.root; controller = new AbortController();
            query("#assignmentProjectSelect").addEventListener("change", loadProjectData, { signal: controller.signal });
            query("#projectCompanyForm").addEventListener("submit", (event) => saveCompany(event).catch((error) => Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message, "error")), { signal: controller.signal });
            query("#clearProjectCompanyButton").addEventListener("click", clearCompanyForm, { signal: controller.signal });
            query("#deleteProjectCompanyButton").addEventListener("click", () => deleteCompany().catch((error) => Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message, "error")), { signal: controller.signal });
            query("#projectCompanyTableBody").addEventListener("click", (event) => { const id = event.target.closest("tr[data-company-id]")?.dataset.companyId; const item = companies.find((row) => String(value(row, "projectCompanyId", "PROJECT_COMPANY_ID")) === id); if (item) fillCompanyForm(item); }, { signal: controller.signal });
            query("#assignmentTableBody").addEventListener("click", (event) => { const id = event.target.closest("tr[data-assignment-id]")?.dataset.assignmentId; const item = assignments.find((row) => String(value(row, "assignmentId", "ASSIGNMENT_ID")) === id); if (item) fillAssignmentForm(item); }, { signal: controller.signal });
            query("#newAssignmentButton").addEventListener("click", () => {
                if (!selectedProjectId()) {
                    const message = "프로젝트를 먼저 선택해 주세요.";
                    Common.ui.toast(message, "warning");
                    Common.ui.setInlineStatus(query("#assignmentPageStatus"), message, "error");
                    query("#assignmentProjectSelect").focus();
                    return;
                }
                clearAssignmentForm();
                query("#assignmentEmployee").focus();
            }, { signal: controller.signal });
            query("#clearAssignmentButton").addEventListener("click", clearAssignmentForm, { signal: controller.signal });
            query("#generateMonthlyAllocationButton").addEventListener("click", generateMonthlyAllocations, { signal: controller.signal });
            query("#assignmentAllocationType").addEventListener("change", () => { query("#assignmentWeekdays").hidden = query("#assignmentAllocationType").value !== "WEEKLY"; }, { signal: controller.signal });
            query("#assignmentWeekdays").addEventListener("change", () => { if (query("#assignmentAllocationType").value === "WEEKLY") generateMonthlyAllocations(); }, { signal: controller.signal });
            query("#monthlyAllocationBody").addEventListener("input", updateMonthlyTotals, { signal: controller.signal });
            query("#assignmentCostUnitPrice").addEventListener("input", updateMonthlyTotals, { signal: controller.signal });
            query("#assignmentSalesUnitPrice").addEventListener("input", updateMonthlyTotals, { signal: controller.signal });
            query("#assignmentForm").addEventListener("submit", (event) => saveAssignment(event).catch((error) => Common.ui.setInlineStatus(query("#assignmentEditorStatus"), error.message, "error")), { signal: controller.signal });
            query("#deleteAssignmentButton").addEventListener("click", () => deleteAssignment().catch((error) => Common.ui.setInlineStatus(query("#assignmentEditorStatus"), error.message, "error")), { signal: controller.signal });
            await loadReferences();
        },
        destroy() { controller?.abort(); controller = null; root = null; projects = []; employees = []; companies = []; assignments = []; }
    };
})();
