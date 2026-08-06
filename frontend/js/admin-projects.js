(function() {
    "use strict";

    const PAGE_NAME = "admin-projects";
    const STATUS_LABELS = {
        PLANNED: "계획",
        BIDDING: "입찰",
        CONTRACTED: "계약",
        IN_PROGRESS: "진행",
        COMPLETED: "완료",
        CANCELLED: "취소"
    };
    const PARTICIPATION_LABELS = {
        LEAD: "주관사",
        CONSORTIUM: "컨소사",
        SUBCONTRACT: "하도급"
    };

    let root = null;
    let controller = null;
    let grid = null;
    let detailRequestId = 0;

    function query(selector) {
        return root?.querySelector(selector) || null;
    }

    function value(row, ...keys) {
        return Common.data.pick(row, ...keys);
    }

    function projectId(row) {
        return value(row, "projectId", "PROJECT_ID", "id", "ID");
    }

    function setValue(selector, nextValue) {
        const element = query(selector);
        if (element) element.value = nextValue ?? "";
    }

    function dateValue(nextValue) {
        return nextValue ? String(nextValue).slice(0, 10) : "";
    }

    function formatDate(nextValue) {
        const normalized = dateValue(nextValue);
        return normalized || "-";
    }

    function formatAmount(nextValue) {
        if (nextValue === null || nextValue === undefined || nextValue === "") return "-";
        const amount = String(nextValue);
        if (/^\d+$/.test(amount)) {
            return `${amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}원`;
        }
        return amount;
    }

    function cell(text = "", className = "") {
        return Common.dom.element("td", { text: text ?? "", className });
    }

    function renderProjectRow(project) {
        const statusCode = String(value(project, "statusCode", "STATUS_CODE") || "PLANNED");
        const participationType = String(
            value(project, "participationTypeCode", "PARTICIPATION_TYPE_CODE") || ""
        );
        const row = Common.dom.element("tr");
        const nameCell = cell("", "project-name-cell");
        nameCell.appendChild(Common.dom.element("strong", {
            text: value(project, "projectName", "PROJECT_NAME") || "이름 없음"
        }));
        const statusCell = cell();
        statusCell.appendChild(Common.dom.element("span", {
            className: `project-status-badge is-${statusCode.toLowerCase().replaceAll("_", "-")}`,
            text: STATUS_LABELS[statusCode] || statusCode
        }));

        row.append(
            cell(value(project, "projectYear", "PROJECT_YEAR") || "-"),
            nameCell,
            cell(value(project, "customerName", "CUSTOMER_NAME") || "-"),
            statusCell,
            cell(`${formatDate(value(project, "projectStartDate", "PROJECT_START_DATE"))} ~ ${formatDate(value(project, "projectEndDate", "PROJECT_END_DATE"))}`),
            cell(formatAmount(value(project, "orderAmountVat", "ORDER_AMOUNT_VAT")), "number-column"),
            cell(formatAmount(value(project, "contractAmountVat", "CONTRACT_AMOUNT_VAT")), "number-column"),
            cell(PARTICIPATION_LABELS[participationType] || participationType || "-"),
            cell(`${value(project, "participationRate", "PARTICIPATION_RATE") ?? 0}%`, "number-column"),
            cell(formatDate(value(project, "orderDate", "ORDER_DATE"))),
            cell(formatDate(value(project, "bidDate", "BID_DATE")))
        );
        return row;
    }

    function searchParameters() {
        return {
            projectYear: query("#projectYearFilter").value,
            keyword: query("#projectKeyword").value.trim(),
            statusCode: query("#projectStatusFilter").value,
            participationTypeCode: query("#projectParticipationFilter").value,
            periodStart: query("#projectPeriodStartFilter").value,
            periodEnd: query("#projectPeriodEndFilter").value,
            bidDateFrom: query("#projectBidDateFromFilter").value,
            bidDateTo: query("#projectBidDateToFilter").value,
            contractAmountMin: query("#projectContractAmountMinFilter").value,
            contractAmountMax: query("#projectContractAmountMaxFilter").value
        };
    }

    function validateRange(fromSelector, toSelector, message) {
        const from = query(fromSelector).value;
        const to = query(toSelector).value;
        if (!from || !to || from <= to) return true;
        Common.ui.setInlineStatus(query("#projectListStatus"), message, "error");
        query(toSelector).focus();
        return false;
    }

    function validateSearch() {
        const form = query("#projectSearchForm");
        if (!form.reportValidity()) return false;
        if (!validateRange(
            "#projectPeriodStartFilter",
            "#projectPeriodEndFilter",
            "프로젝트 기간의 종료 범위를 확인해 주세요."
        )) return false;
        if (!validateRange(
            "#projectBidDateFromFilter",
            "#projectBidDateToFilter",
            "입찰일의 종료 범위를 확인해 주세요."
        )) return false;

        const minimum = query("#projectContractAmountMinFilter").value;
        const maximum = query("#projectContractAmountMaxFilter").value;
        for (const [amount, selector] of [
            [minimum, "#projectContractAmountMinFilter"],
            [maximum, "#projectContractAmountMaxFilter"]
        ]) {
            if (amount && !/^\d{1,18}$/.test(amount)) {
                Common.ui.setInlineStatus(
                    query("#projectListStatus"),
                    "수주금액은 0 이상의 18자리 이내 정수로 입력해 주세요.",
                    "error"
                );
                query(selector).focus();
                return false;
            }
        }
        if (minimum && maximum && BigInt(minimum) > BigInt(maximum)) {
            Common.ui.setInlineStatus(query("#projectListStatus"), "수주금액 범위를 확인해 주세요.", "error");
            query("#projectContractAmountMaxFilter").focus();
            return false;
        }
        return true;
    }

    function setDetailSearchExpanded(expanded) {
        const fields = query("#projectDetailSearchFields");
        const button = query("#toggleProjectDetailSearchButton");
        if (!fields || !button) return;
        fields.hidden = !expanded;
        button.setAttribute("aria-expanded", String(expanded));
        button.textContent = expanded ? "상세조회 접기" : "상세조회";
    }

    async function fetchProjectPage(state) {
        const queryString = Common.api.query({
            ...searchParameters(),
            page: state.page,
            pageSize: state.pageSize,
            sortBy: state.sortBy,
            sortDirection: state.sortDirection
        });
        return Common.api.request(`/admin/projects${queryString}`, {
            method: "GET",
            signal: state.signal,
            showLoading: false
        });
    }

    function auditText(project, prefix) {
        const name = value(project, `${prefix}ByName`, `${prefix.toUpperCase()}_BY_NAME`);
        const userId = value(project, `${prefix}By`, `${prefix.toUpperCase()}_BY`);
        const timestamp = value(project, `${prefix}At`, `${prefix.toUpperCase()}_AT`);
        if (!timestamp && !name && !userId) return "-";
        const actor = name || (userId ? `사용자 #${userId}` : "시스템");
        return `${actor} · ${Common.format.dateTime(timestamp)}`;
    }

    function fillProjectForm(project = {}) {
        const id = projectId(project) || "";
        setValue("#projectId", id);
        setValue("#projectYear", value(project, "projectYear", "PROJECT_YEAR") || new Date().getFullYear());
        setValue("#projectName", value(project, "projectName", "PROJECT_NAME") || "");
        setValue("#projectCustomerName", value(project, "customerName", "CUSTOMER_NAME") || "");
        setValue("#projectStartDate", dateValue(value(project, "projectStartDate", "PROJECT_START_DATE")));
        setValue("#projectEndDate", dateValue(value(project, "projectEndDate", "PROJECT_END_DATE")));
        setValue("#projectOrderAmountVat", value(project, "orderAmountVat", "ORDER_AMOUNT_VAT") ?? 0);
        setValue("#projectContractAmountVat", value(project, "contractAmountVat", "CONTRACT_AMOUNT_VAT") ?? 0);
        setValue(
            "#projectParticipationTypeCode",
            value(project, "participationTypeCode", "PARTICIPATION_TYPE_CODE") || "LEAD"
        );
        setValue("#projectParticipationRate", value(project, "participationRate", "PARTICIPATION_RATE") ?? 100);
        setValue("#projectOrderDate", dateValue(value(project, "orderDate", "ORDER_DATE")));
        setValue("#projectBidDate", dateValue(value(project, "bidDate", "BID_DATE")));
        setValue("#projectStatusCode", value(project, "statusCode", "STATUS_CODE") || "PLANNED");
        setValue("#projectDescription", value(project, "description", "DESCRIPTION") || "");

        query("#projectEditorTitle").textContent = id ? "프로젝트 상세 및 수정" : "프로젝트 등록";
        query("#projectEditorDescription").textContent = id
            ? `프로젝트 #${id}을(를) 수정하고 있습니다.`
            : "새 프로젝트를 등록하고 있습니다.";
        query("#deleteProjectButton").hidden = !id;
        query("#projectAuditInfo").hidden = !id;
        query("#projectCreatedAudit").textContent = id ? auditText(project, "created") : "-";
        query("#projectUpdatedAudit").textContent = id ? auditText(project, "updated") : "-";
        Common.ui.setInlineStatus(query("#projectEditorStatus"), "");
        grid?.setSelectedKey(id);
    }

    function newProject(options = {}) {
        detailRequestId += 1;
        query("#projectForm")?.reset();
        grid?.clearSelection();
        fillProjectForm();
        if (options.focus !== false) query("#projectName")?.focus();
    }

    async function loadProject(id) {
        if (!id) return;
        const requestId = ++detailRequestId;
        grid?.setSelectedKey(id);
        Common.ui.setInlineStatus(query("#projectEditorStatus"), "프로젝트 상세를 불러오고 있습니다.");
        try {
            const payload = await Common.api.request(`/admin/projects/${encodeURIComponent(id)}`, {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            if (requestId !== detailRequestId) return;
            fillProjectForm(Common.data.get(payload) || {});
            if (window.matchMedia("(max-width: 760px)").matches) {
                query("#projectEditorPanel")?.scrollIntoView({
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                    block: "start"
                });
            }
        } catch (error) {
            if (requestId !== detailRequestId || error?.name === "AbortError") return;
            Common.ui.setInlineStatus(
                query("#projectEditorStatus"),
                error.message || "프로젝트 상세를 불러오지 못했습니다.",
                "error"
            );
        }
    }

    function validWholeAmount(selector, label) {
        const element = query(selector);
        const amount = element.value.trim();
        if (/^\d{1,18}$/.test(amount)) return true;
        Common.ui.setInlineStatus(
            query("#projectEditorStatus"),
            `${label}은 0 이상의 18자리 이내 정수로 입력해 주세요.`,
            "error"
        );
        element.focus();
        return false;
    }

    function projectPayload() {
        return {
            projectYear: Number(query("#projectYear").value),
            projectName: query("#projectName").value.trim(),
            customerName: query("#projectCustomerName").value.trim(),
            projectStartDate: query("#projectStartDate").value,
            projectEndDate: query("#projectEndDate").value,
            orderAmountVat: query("#projectOrderAmountVat").value,
            contractAmountVat: query("#projectContractAmountVat").value,
            participationTypeCode: query("#projectParticipationTypeCode").value,
            participationRate: query("#projectParticipationRate").value,
            orderDate: query("#projectOrderDate").value || null,
            bidDate: query("#projectBidDate").value || null,
            statusCode: query("#projectStatusCode").value,
            description: query("#projectDescription").value.trim()
        };
    }

    function validateProjectForm() {
        const form = query("#projectForm");
        Common.ui.setInlineStatus(query("#projectEditorStatus"), "");
        if (!form.reportValidity()) return false;
        if (query("#projectStartDate").value > query("#projectEndDate").value) {
            Common.ui.setInlineStatus(
                query("#projectEditorStatus"),
                "프로젝트 종료일은 시작일보다 빠를 수 없습니다.",
                "error"
            );
            query("#projectEndDate").focus();
            return false;
        }
        return validWholeAmount("#projectOrderAmountVat", "발주금액")
            && validWholeAmount("#projectContractAmountVat", "수주금액");
    }

    async function saveProject(event) {
        event.preventDefault();
        if (!validateProjectForm()) return;
        const id = query("#projectId").value;
        const button = query("#saveProjectButton");
        button.disabled = true;
        try {
            const response = await Common.api.request(
                id ? `/admin/projects/${encodeURIComponent(id)}` : "/admin/projects",
                {
                    method: id ? "PUT" : "POST",
                    body: projectPayload(),
                    signal: controller.signal,
                    loadingMessage: "프로젝트를 저장하고 있습니다."
                }
            );
            const saved = Common.data.get(response) || {};
            const savedId = projectId(saved) || id;
            fillProjectForm(saved);
            Common.ui.toast("프로젝트를 저장했습니다.", "success");
            await grid.load();
            grid.setSelectedKey(savedId);
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.setInlineStatus(
                    query("#projectEditorStatus"),
                    error.message || "프로젝트를 저장하지 못했습니다.",
                    "error"
                );
            }
        } finally {
            button.disabled = false;
        }
    }

    async function deleteProject() {
        const id = query("#projectId").value;
        const name = query("#projectName").value.trim() || "선택한 프로젝트";
        if (!id || !(await Common.ui.confirm(
            `“${name}” 프로젝트를 삭제하시겠습니까?`,
            { title: "프로젝트 삭제", confirmText: "삭제", danger: true }
        ))) return;

        const button = query("#deleteProjectButton");
        button.disabled = true;
        try {
            await Common.api.request(`/admin/projects/${encodeURIComponent(id)}`, {
                method: "DELETE",
                signal: controller.signal,
                loadingMessage: "프로젝트를 삭제하고 있습니다."
            });
            Common.ui.toast("프로젝트를 삭제했습니다.", "success");
            newProject({ focus: false });
            await grid.load();
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.setInlineStatus(
                    query("#projectEditorStatus"),
                    error.message || "프로젝트를 삭제하지 못했습니다.",
                    "error"
                );
            }
        } finally {
            button.disabled = false;
        }
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            root = context.root;
            controller = new AbortController();
            grid = Common.grid.create({
                root,
                body: "#projectTableBody",
                pagination: "#projectPagination",
                status: "#projectListStatus",
                pageSizeSelect: "#projectPageSize",
                columnCount: 11,
                pageSize: 20,
                sortBy: "projectYear",
                sortDirection: "desc",
                fetchPage: fetchProjectPage,
                renderRow: renderProjectRow,
                rowKey: projectId,
                onSelect: (project) => loadProject(projectId(project)),
                emptyMessage: "조회된 프로젝트가 없습니다.",
                loadingMessage: "프로젝트 목록을 불러오고 있습니다.",
                signal: controller.signal
            });

            query("#projectSearchForm")?.addEventListener("submit", (event) => {
                event.preventDefault();
                if (!validateSearch()) return;
                newProject({ focus: false });
                grid.load({ resetPage: true });
            }, { signal: controller.signal });
            query("#resetProjectSearchButton")?.addEventListener("click", () => {
                query("#projectSearchForm")?.reset();
                setDetailSearchExpanded(false);
                newProject({ focus: false });
                grid.setPageSize(query("#projectPageSize").value, { reload: false });
                grid.load({ resetPage: true });
            }, { signal: controller.signal });
            query("#toggleProjectDetailSearchButton")?.addEventListener("click", () => {
                const expanded = query("#toggleProjectDetailSearchButton").getAttribute("aria-expanded") === "true";
                setDetailSearchExpanded(!expanded);
            }, { signal: controller.signal });
            query("#newProjectButton")?.addEventListener("click", () => newProject(), {
                signal: controller.signal
            });
            query("#clearProjectButton")?.addEventListener("click", () => newProject(), {
                signal: controller.signal
            });
            query("#projectForm")?.addEventListener("submit", saveProject, {
                signal: controller.signal
            });
            query("#deleteProjectButton")?.addEventListener("click", deleteProject, {
                signal: controller.signal
            });

            newProject({ focus: false });
            await grid.load();
        },

        destroy() {
            detailRequestId += 1;
            grid?.destroy();
            controller?.abort();
            grid = null;
            controller = null;
            root = null;
        }
    };
})();
