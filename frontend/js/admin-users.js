(function() {
    "use strict";

    let controller = null;
    let root = null;
    let users = [];

    function query(selector) {
        return root?.querySelector(selector) || null;
    }

    function value(row, ...keys) {
        return Common.data.pick(row, ...keys);
    }

    function userId(row) {
        return value(row, "userId", "USER_ID", "id", "ID");
    }

    function option(valueText, label, selected) {
        const element = Common.dom.element("option", { text: label, value: valueText });
        element.selected = selected;
        return element;
    }

    function cell(text = "") {
        return Common.dom.element("td", { text: text ?? "" });
    }

    function renderUsers() {
        const body = query("#userTableBody");
        Common.dom.clear(body);

        if (!users.length) {
            const row = Common.dom.element("tr");
            const empty = cell("조회된 사용자가 없습니다.");
            empty.colSpan = 6;
            empty.style.textAlign = "center";
            row.appendChild(empty);
            body.appendChild(row);
            return;
        }

        users.forEach((row) => {
            const id = userId(row);
            const role = String(value(row, "roleCode", "ROLE_CODE") || "USER").toUpperCase();
            const useYn = String(value(row, "useYn", "USE_YN") || "Y").toUpperCase();
            const tableRow = Common.dom.element("tr");

            tableRow.append(
                cell(value(row, "loginId", "LOGIN_ID") || ""),
                cell(value(row, "userName", "USER_NAME") || ""),
                cell(value(row, "email", "EMAIL") || "")
            );

            const roleCell = cell();
            const roleSelect = Common.dom.element("select", {
                className: "select",
                attrs: { "aria-label": "사용자 권한" }
            });
            roleSelect.append(
                option("USER", "사용자", role === "USER"),
                option("ADMIN", "관리자", role === "ADMIN")
            );
            roleCell.appendChild(roleSelect);

            const useCell = cell();
            const useSelect = Common.dom.element("select", {
                className: "select",
                attrs: { "aria-label": "사용 여부" }
            });
            useSelect.append(
                option("Y", "사용", useYn === "Y"),
                option("N", "중지", useYn === "N")
            );
            useCell.appendChild(useSelect);

            const actionCell = cell();
            const actions = Common.dom.element("div", { className: "table-actions" });
            const saveButton = Common.dom.element("button", {
                className: "button button-secondary",
                text: "저장",
                type: "button"
            });
            const resetButton = Common.dom.element("button", {
                className: "button button-quiet",
                text: "비밀번호 초기화",
                type: "button"
            });
            saveButton.addEventListener("click", () => saveUser(id, roleSelect.value, useSelect.value, saveButton), {
                signal: controller.signal
            });
            resetButton.addEventListener("click", () => resetPassword(id, resetButton), {
                signal: controller.signal
            });
            actions.append(saveButton, resetButton);
            actionCell.appendChild(actions);

            tableRow.append(roleCell, useCell, actionCell);
            body.appendChild(tableRow);
        });
    }

    async function loadUsers() {
        const status = query("#userListStatus");
        Common.ui.setInlineStatus(status, "사용자 목록을 불러오고 있습니다.");
        try {
            const queryString = Common.api.query({
                keyword: query("#userKeyword").value.trim(),
                useYn: query("#userUseYn").value,
                limit: query("#userLimit").value
            });
            const payload = await Common.api.request(`/admin/users${queryString}`, {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            users = Common.data.rows(payload, "users", "items", "rows");
            renderUsers();
            Common.ui.setInlineStatus(status, `${users.length.toLocaleString("ko-KR")}명의 사용자를 조회했습니다.`);
        } catch (error) {
            if (error?.name === "AbortError") return;
            users = [];
            renderUsers();
            Common.ui.setInlineStatus(status, error.message || "사용자 목록을 불러오지 못했습니다.", "error");
        }
    }

    async function saveUser(id, roleCode, useYn, button) {
        if (!id) return;
        button.disabled = true;
        try {
            await Common.api.request(`/admin/users/${encodeURIComponent(id)}`, {
                method: "PATCH",
                body: { roleCode, useYn },
                signal: controller.signal,
                loadingMessage: "사용자 정보를 저장하고 있습니다."
            });
            Common.ui.toast("사용자 정보를 저장했습니다.", "success");
            await loadUsers();
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.toast(error.message || "사용자 정보를 저장하지 못했습니다.", "error");
            }
        } finally {
            button.disabled = false;
        }
    }

    async function resetPassword(id, button) {
        if (!id || !(await Common.ui.confirm("선택한 사용자의 비밀번호를 초기화하시겠습니까?"))) return;
        button.disabled = true;
        try {
            const payload = await Common.api.request(`/admin/users/${encodeURIComponent(id)}/reset-password`, {
                method: "POST",
                signal: controller.signal,
                loadingMessage: "임시 비밀번호를 만들고 있습니다."
            });
            const data = Common.data.get(payload) || {};
            const password = value(data, "temporaryPassword", "TEMPORARY_PASSWORD", "password", "PASSWORD");
            if (!password) throw new Error("서버 응답에서 임시 비밀번호를 확인하지 못했습니다.");

            query("#temporaryPasswordValue").textContent = String(password);
            query("#temporaryPasswordDialog")?.showModal();
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.toast(error.message || "비밀번호를 초기화하지 못했습니다.", "error");
            }
        } finally {
            button.disabled = false;
        }
    }

    window.Pages["admin-users"] = {
        async init(context) {
            root = context.root;
            controller = new AbortController();
            query("#userSearchForm")?.addEventListener("submit", (event) => {
                event.preventDefault();
                loadUsers();
            }, { signal: controller.signal });
            root.querySelectorAll("[data-dialog-close]").forEach((button) => {
                button.addEventListener("click", () => button.closest("dialog")?.close(), { signal: controller.signal });
            });
            query("#temporaryPasswordDialog")?.addEventListener("close", () => {
                query("#temporaryPasswordValue").textContent = "";
            }, { signal: controller.signal });
            query("#copyTemporaryPasswordButton")?.addEventListener("click", async () => {
                await Common.copyText(query("#temporaryPasswordValue").textContent || "");
                Common.ui.toast("임시 비밀번호를 복사했습니다.", "success");
            }, { signal: controller.signal });
            await loadUsers();
        },

        destroy() {
            controller?.abort();
            controller = null;
            root = null;
            users = [];
        }
    };
})();
