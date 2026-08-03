(function() {
    "use strict";

    let controller = null;
    let root = null;
    let users = [];
    let temporaryAccess = null;
    let reloadUsersAfterTemporaryDialog = false;

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

    function inputFor(valueText, accessibleName, fieldName, options = {}) {
        return Common.dom.element("input", {
            className: `input user-admin-input${options.readOnly ? " is-readonly" : ""}`,
            type: options.type || "text",
            value: valueText,
            attrs: {
                "aria-label": `${accessibleName} ${fieldName}`,
                maxlength: options.maxLength,
                required: options.required ? "" : null,
                disabled: options.readOnly ? "" : null
            }
        });
    }

    function roleSelectFor(role, accessibleName) {
        const select = Common.dom.element("select", {
            className: "select",
            attrs: { "aria-label": `${accessibleName} 권한` }
        });
        select.append(
            option("USER", "사용자", role === "USER"),
            option("ADMIN", "관리자", role === "ADMIN")
        );
        return select;
    }

    function useSelectFor(useYn, accessibleName) {
        const select = Common.dom.element("select", {
            className: "select",
            attrs: { "aria-label": `${accessibleName} 사용 여부` }
        });
        select.append(
            option("Y", "사용", useYn === "Y"),
            option("N", "중지", useYn === "N")
        );
        return select;
    }

    function passwordChangeStatusFor(passwordChangeYn, accessibleName) {
        const normalized = String(passwordChangeYn || "N").toUpperCase() === "Y" ? "Y" : "N";
        return inputFor(
            `${normalized} (${normalized === "Y" ? "변경 완료" : "변경 필요"})`,
            accessibleName,
            "초기 비밀번호 변경 여부",
            { readOnly: true }
        );
    }

    function actionButtons(id, controls, className = "table-actions") {
        const actions = Common.dom.element("div", { className });
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
        const deleteButton = Common.dom.element("button", {
            className: "button button-danger",
            text: "삭제",
            type: "button"
        });
        saveButton.addEventListener("click", () => {
            saveUser(id, controls, saveButton);
        }, { signal: controller.signal });
        resetButton.addEventListener("click", () => resetPassword(id, resetButton), {
            signal: controller.signal
        });
        deleteButton.addEventListener("click", () => {
            deleteUser(id, controls.userName.value.trim() || controls.loginId.value.trim(), deleteButton);
        }, { signal: controller.signal });
        actions.append(saveButton, resetButton, deleteButton);
        return actions;
    }

    function mobileField(labelText, control) {
        const label = Common.dom.element("label", { className: "field user-card-field" });
        label.append(Common.dom.element("span", { text: labelText }), control);
        return label;
    }

    function renderUserCard(cardList, row, id, role, useYn) {
        const loginId = String(value(row, "loginId", "LOGIN_ID") || "");
        const userName = String(value(row, "userName", "USER_NAME") || loginId || "사용자");
        const email = String(value(row, "email", "EMAIL") || "이메일 없음");
        const accessibleName = userName || loginId || "사용자";
        const passwordChangeYn = String(value(row, "passwordChangeYn", "PASSWORD_CHANGE_YN") || "N").toUpperCase();
        const controls = {
            loginId: inputFor(loginId, accessibleName, "로그인 ID", { maxLength: 100, required: true }),
            userName: inputFor(userName, accessibleName, "이름", { maxLength: 200, required: true }),
            email: inputFor(email === "이메일 없음" ? "" : email, accessibleName, "이메일", {
                type: "email",
                maxLength: 300,
                required: true
            }),
            roleCode: roleSelectFor(role, accessibleName),
            useYn: useSelectFor(useYn, accessibleName)
        };
        const userIdInput = inputFor(id, accessibleName, "USER_ID", { readOnly: true });
        const card = Common.dom.element("article", { className: "user-admin-card" });
        const header = Common.dom.element("header", { className: "user-admin-card-header" });
        const identity = Common.dom.element("div", { className: "user-card-identity" });
        identity.append(
            Common.dom.element("strong", { text: userName }),
            Common.dom.element("span", { text: loginId })
        );
        header.append(
            identity,
            Common.dom.element("span", {
                className: `user-status-badge${useYn === "Y" ? " is-active" : " is-inactive"}`,
                text: useYn === "Y" ? "사용 중" : "중지"
            })
        );
        card.append(
            header,
            Common.dom.element("div", { className: "user-card-control-grid" })
        );
        const controlGrid = card.querySelector(".user-card-control-grid");
        controlGrid.append(
            mobileField("USER_ID", userIdInput),
            mobileField("로그인 ID", controls.loginId),
            mobileField("이름", controls.userName),
            mobileField("이메일", controls.email),
            mobileField("권한", controls.roleCode),
            mobileField("사용 여부", controls.useYn),
            mobileField("초기 비밀번호 변경", passwordChangeStatusFor(passwordChangeYn, accessibleName))
        );
        card.append(actionButtons(id, controls, "user-card-actions"));
        cardList.appendChild(card);
    }

    function renderUsers() {
        const body = query("#userTableBody");
        const cardList = query("#userCardList");
        Common.dom.clear(body);
        Common.dom.clear(cardList);

        if (!users.length) {
            const row = Common.dom.element("tr");
            const empty = cell("조회된 사용자가 없습니다.");
            empty.colSpan = 8;
            empty.style.textAlign = "center";
            row.appendChild(empty);
            body.appendChild(row);
            cardList.appendChild(Common.dom.element("div", {
                className: "empty-state compact",
                text: "조회된 사용자가 없습니다."
            }));
            return;
        }

        users.forEach((row) => {
            const id = userId(row);
            const role = String(value(row, "roleCode", "ROLE_CODE") || "USER").toUpperCase();
            const useYn = String(value(row, "useYn", "USE_YN") || "Y").toUpperCase();
            const passwordChangeYn = String(value(row, "passwordChangeYn", "PASSWORD_CHANGE_YN") || "N").toUpperCase();
            const accessibleName = String(value(row, "userName", "USER_NAME", "loginId", "LOGIN_ID") || "사용자");
            const tableRow = Common.dom.element("tr");
            const controls = {
                loginId: inputFor(value(row, "loginId", "LOGIN_ID") || "", accessibleName, "로그인 ID", {
                    maxLength: 100,
                    required: true
                }),
                userName: inputFor(value(row, "userName", "USER_NAME") || "", accessibleName, "이름", {
                    maxLength: 200,
                    required: true
                }),
                email: inputFor(value(row, "email", "EMAIL") || "", accessibleName, "이메일", {
                    type: "email",
                    maxLength: 300,
                    required: true
                }),
                roleCode: roleSelectFor(role, accessibleName),
                useYn: useSelectFor(useYn, accessibleName)
            };

            const idCell = cell();
            idCell.appendChild(inputFor(id, accessibleName, "USER_ID", { readOnly: true }));
            const loginIdCell = cell();
            loginIdCell.appendChild(controls.loginId);
            const userNameCell = cell();
            userNameCell.appendChild(controls.userName);
            const emailCell = cell();
            emailCell.appendChild(controls.email);
            const roleCell = cell();
            roleCell.appendChild(controls.roleCode);
            const useCell = cell();
            useCell.appendChild(controls.useYn);
            const passwordChangeCell = cell();
            passwordChangeCell.appendChild(passwordChangeStatusFor(passwordChangeYn, accessibleName));

            const actionCell = cell();
            actionCell.appendChild(actionButtons(id, controls));

            tableRow.append(
                idCell,
                loginIdCell,
                userNameCell,
                emailCell,
                roleCell,
                useCell,
                passwordChangeCell,
                actionCell
            );
            body.appendChild(tableRow);
            renderUserCard(cardList, row, id, role, useYn);
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

    async function saveUser(id, controls, button) {
        if (!id) return;
        const editableControls = [controls.loginId, controls.userName, controls.email];
        const invalidControl = editableControls.find((control) => !control.checkValidity());
        if (invalidControl) {
            invalidControl.reportValidity();
            return;
        }

        button.disabled = true;
        try {
            await Common.api.request(`/admin/users/${encodeURIComponent(id)}`, {
                method: "PATCH",
                body: {
                    loginId: controls.loginId.value.trim(),
                    userName: controls.userName.value.trim(),
                    email: controls.email.value.trim(),
                    roleCode: controls.roleCode.value,
                    useYn: controls.useYn.value
                },
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

    function showTemporaryPassword(password, identity = {}) {
        const loginId = String(value(identity, "loginId", "LOGIN_ID") || "");
        const userName = String(value(identity, "userName", "USER_NAME") || "");
        temporaryAccess = {
            siteUrl: window.location.origin,
            loginId,
            userName,
            password: String(password)
        };
        query("#temporarySiteUrl").textContent = temporaryAccess.siteUrl;
        query("#temporaryLoginId").textContent = temporaryAccess.loginId;
        query("#temporaryPasswordValue").textContent = String(password);
        query("#temporaryPasswordDialog")?.showModal();
    }

    async function createUser(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const button = query("#createUserSubmitButton");
        const status = query("#createUserStatus");
        if (!form.reportValidity()) return;

        button.disabled = true;
        Common.ui.setInlineStatus(status, "사용자를 추가하고 있습니다.");
        try {
            const payload = await Common.api.request("/admin/users", {
                method: "POST",
                body: {
                    loginId: query("#createUserLoginId").value.trim(),
                    userName: query("#createUserName").value.trim(),
                    email: query("#createUserEmail").value.trim(),
                    roleCode: query("#createUserRoleCode").value,
                    useYn: query("#createUserUseYn").value
                },
                signal: controller.signal,
                loadingMessage: "사용자를 추가하고 있습니다."
            });
            const data = Common.data.get(payload) || {};
            const password = value(data, "temporaryPassword", "TEMPORARY_PASSWORD", "password", "PASSWORD");
            if (!password) throw new Error("서버 응답에서 임시 비밀번호를 확인하지 못했습니다.");

            query("#createUserDialog")?.close();
            form.reset();
            Common.ui.setInlineStatus(status, "");
            Common.ui.toast("사용자를 추가했습니다.", "success");
            showTemporaryPassword(password, data);
            reloadUsersAfterTemporaryDialog = true;
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.setInlineStatus(status, error.message || "사용자를 추가하지 못했습니다.", "error");
            }
        } finally {
            button.disabled = false;
        }
    }

    async function deleteUser(id, userLabel, button) {
        if (!id) return;
        const confirmed = await Common.ui.confirm(
            `${userLabel || "선택한 사용자"} 계정을 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
            { title: "사용자 삭제", confirmText: "삭제", danger: true }
        );
        if (!confirmed) return;

        button.disabled = true;
        try {
            await Common.api.request(`/admin/users/${encodeURIComponent(id)}`, {
                method: "DELETE",
                signal: controller.signal,
                loadingMessage: "사용자를 삭제하고 있습니다."
            });
            Common.ui.toast("사용자를 삭제했습니다.", "success");
            await loadUsers();
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.toast(error.message || "사용자를 삭제하지 못했습니다.", "error", { duration: 0 });
            }
        } finally {
            button.disabled = false;
        }
    }

    async function resetPassword(id, button) {
        if (!id || !(await Common.ui.confirm(
            "선택한 사용자의 비밀번호를 초기화하시겠습니까? 기존 로그인 세션은 모두 종료됩니다.",
            { title: "비밀번호 초기화", confirmText: "초기화" }
        ))) return;
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

            showTemporaryPassword(password, data);
            reloadUsersAfterTemporaryDialog = true;
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
            query("#openCreateUserButton")?.addEventListener("click", () => {
                query("#createUserForm")?.reset();
                Common.ui.setInlineStatus(query("#createUserStatus"), "");
                query("#createUserDialog")?.showModal();
                query("#createUserLoginId")?.focus();
            }, { signal: controller.signal });
            query("#createUserForm")?.addEventListener("submit", createUser, {
                signal: controller.signal
            });
            root.querySelectorAll("[data-dialog-close]").forEach((button) => {
                button.addEventListener("click", () => button.closest("dialog")?.close(), { signal: controller.signal });
            });
            query("#temporaryPasswordDialog")?.addEventListener("close", () => {
                query("#temporaryPasswordValue").textContent = "";
                query("#temporaryLoginId").textContent = "";
                query("#temporarySiteUrl").textContent = "";
                temporaryAccess = null;
                if (reloadUsersAfterTemporaryDialog) {
                    reloadUsersAfterTemporaryDialog = false;
                    loadUsers();
                }
            }, { signal: controller.signal });
            query("#copyTemporaryPasswordButton")?.addEventListener("click", async () => {
                await Common.copyText(query("#temporaryPasswordValue").textContent || "");
                Common.ui.toast("임시 비밀번호를 복사했습니다.", "success");
            }, { signal: controller.signal });
            query("#copyTemporaryAccessGuideButton")?.addEventListener("click", async () => {
                if (!temporaryAccess) return;
                const guide = [
                    "[INIT Members 계정 안내]",
                    `접속 주소: ${temporaryAccess.siteUrl}`,
                    `로그인 ID: ${temporaryAccess.loginId}`,
                    `임시 비밀번호: ${temporaryAccess.password}`,
                    "최초 로그인 후 안내에 따라 새 비밀번호로 반드시 변경해 주세요."
                ].join("\n");
                await Common.copyText(guide);
                Common.ui.toast("접속 안내문을 복사했습니다.", "success");
            }, { signal: controller.signal });
            await loadUsers();
        },

        destroy() {
            controller?.abort();
            controller = null;
            root = null;
            users = [];
            temporaryAccess = null;
            reloadUsersAfterTemporaryDialog = false;
        }
    };
})();
