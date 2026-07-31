(function() {
    "use strict";

    let controller = null;
    let root = null;

    function query(selector) {
        return root?.querySelector(selector) || null;
    }

    function fillAccount(source) {
        const user = Common.data.normalizeUser(source) || App.getUser() || {};
        query("#accountLoginId").value = user.loginId || "";
        query("#accountRoleCode").value = user.roleCode === "ADMIN" ? "관리자" : "사용자";
        query("#accountUserName").value = user.userName || "";
        query("#accountEmail").value = user.email || "";
    }

    async function loadAccount() {
        const status = query("#profileStatus");
        Common.ui.setInlineStatus(status, "계정 정보를 불러오고 있습니다.");
        try {
            const payload = await Common.api.request("/account/me", {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            fillAccount(payload);
            Common.ui.setInlineStatus(status, "");
        } catch (error) {
            if (error?.name === "AbortError") return;
            Common.ui.setInlineStatus(status, error.message || "계정 정보를 불러오지 못했습니다.", "error");
        }
    }

    async function saveProfile(event) {
        event.preventDefault();
        const status = query("#profileStatus");
        Common.ui.setInlineStatus(status, "");
        try {
            const payload = await Common.api.request("/account/profile", {
                method: "PUT",
                body: {
                    userName: query("#accountUserName").value.trim(),
                    email: query("#accountEmail").value.trim()
                },
                signal: controller.signal,
                loadingMessage: "프로필을 저장하고 있습니다."
            });
            const updatedUser = App.setSessionUser(payload);
            fillAccount(updatedUser || payload);
            Common.ui.setInlineStatus(status, "프로필을 저장했습니다.", "success");
            Common.ui.toast("프로필을 저장했습니다.", "success");
        } catch (error) {
            if (error?.name === "AbortError") return;
            Common.ui.setInlineStatus(status, error.message || "프로필을 저장하지 못했습니다.", "error");
        }
    }

    async function changePassword(event) {
        event.preventDefault();
        const status = query("#passwordStatus");
        const currentPassword = query("#currentPassword").value;
        const newPassword = query("#newPassword").value;
        const confirmPassword = query("#newPasswordConfirm").value;

        Common.ui.setInlineStatus(status, "");
        if (newPassword.length < 8) {
            Common.ui.setInlineStatus(status, "새 비밀번호는 8자 이상 입력해 주세요.", "error");
            return;
        }
        if (newPassword !== confirmPassword) {
            Common.ui.setInlineStatus(status, "새 비밀번호 확인 값이 일치하지 않습니다.", "error");
            return;
        }

        try {
            await Common.api.request("/account/password", {
                method: "PUT",
                body: { currentPassword, newPassword },
                signal: controller.signal,
                loadingMessage: "비밀번호를 변경하고 있습니다."
            });
            query("#passwordForm").reset();
            Common.ui.setInlineStatus(status, "비밀번호를 변경했습니다.", "success");
            Common.ui.toast("비밀번호를 변경했습니다.", "success");
        } catch (error) {
            if (error?.name === "AbortError") return;
            Common.ui.setInlineStatus(status, error.message || "비밀번호를 변경하지 못했습니다.", "error");
        }
    }

    window.Pages.account = {
        async init(context) {
            root = context.root;
            controller = new AbortController();
            query("#profileForm")?.addEventListener("submit", saveProfile, { signal: controller.signal });
            query("#passwordForm")?.addEventListener("submit", changePassword, { signal: controller.signal });
            query("#accountReloadButton")?.addEventListener("click", loadAccount, { signal: controller.signal });
            await loadAccount();
        },

        destroy() {
            controller?.abort();
            controller = null;
            root = null;
        }
    };
})();
