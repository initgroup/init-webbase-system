(function() {
    "use strict";

    let controller = null;
    let root = null;

    function query(selector) {
        return root?.querySelector(selector) || null;
    }

    function applySkinContent() {
        const currentSkin = App.getSitePreferences().homepageSkin;
        const template = App.getHomepageSkinTemplates().find((item) => item.code === currentSkin);
        if (!template) return;

        query("#loginHeroEyebrow").textContent = template.eyebrow;
        query("#loginHeroDescription").textContent = template.heroDescription;
        query("#loginSignalLabel").textContent = template.signalLabel;

        const title = query("#loginTitle");
        if (title) {
            title.replaceChildren();
            (template.titleLines || []).forEach((line) => {
                title.appendChild(Common.dom.element("span", {
                    className: "login-title-line",
                    text: line
                }));
            });
        }
    }

    function closeDialog(dialog) {
        if (dialog?.open) dialog.close();
    }

    async function submitLogin(event) {
        event.preventDefault();
        const status = query("#loginStatus");
        const button = query("#loginSubmitButton");
        const loginId = query("#loginId")?.value.trim() || "";
        const password = query("#loginPassword")?.value || "";

        Common.ui.setInlineStatus(status, "");
        button.disabled = true;
        try {
            await Common.api.request("/auth/login", {
                method: "POST",
                body: { loginId, password },
                signal: controller.signal,
                loadingMessage: "로그인하고 있습니다."
            });
            const user = await App.refreshSession({ showLoading: false });
            if (!user) throw new Error("로그인 세션을 확인하지 못했습니다.");

            Common.ui.toast(`${user.userName || user.loginId}님, 반갑습니다.`, "success");
            await App.navigate("home", { replaceHash: true });
        } catch (error) {
            if (error?.name === "AbortError") return;
            Common.ui.setInlineStatus(status, error.message || "로그인하지 못했습니다.", "error");
            query("#loginPassword")?.select();
        } finally {
            button.disabled = false;
        }
    }

    function syncAdminKeyField() {
        const isAdmin = query("#signupRoleCode")?.value === "ADMIN";
        const field = query("#signupAdminKeyField");
        const input = query("#signupAdminKey");
        if (field) field.hidden = !isAdmin;
        if (input) {
            input.required = isAdmin;
            input.disabled = !isAdmin;
            if (!isAdmin) input.value = "";
        }
    }

    async function submitSignup(event) {
        event.preventDefault();
        const status = query("#signupStatus");
        const password = query("#signupPassword")?.value || "";
        const passwordConfirm = query("#signupPasswordConfirm")?.value || "";
        const roleCode = query("#signupRoleCode")?.value || "USER";

        Common.ui.setInlineStatus(status, "");
        if (password.length < 8) {
            Common.ui.setInlineStatus(status, "비밀번호는 8자 이상 입력해 주세요.", "error");
            return;
        }
        if (password !== passwordConfirm) {
            Common.ui.setInlineStatus(status, "비밀번호 확인 값이 일치하지 않습니다.", "error");
            return;
        }

        const submitButton = event.submitter;
        if (submitButton) submitButton.disabled = true;
        try {
            const payload = await Common.api.request("/auth/signup", {
                method: "POST",
                body: {
                    loginId: query("#signupLoginId")?.value.trim() || "",
                    userName: query("#signupUserName")?.value.trim() || "",
                    email: query("#signupEmail")?.value.trim() || "",
                    password,
                    roleCode,
                    adminKey: roleCode === "ADMIN" ? (query("#signupAdminKey")?.value || "") : ""
                },
                signal: controller.signal,
                loadingMessage: "가입 정보를 저장하고 있습니다."
            });

            const data = Common.data.get(payload) || payload;
            const message = data?.message || payload?.message || "회원가입 신청을 저장했습니다.";
            Common.ui.toast(message, "success", { duration: 6000 });
            query("#signupForm")?.reset();
            syncAdminKeyField();
            closeDialog(query("#signupDialog"));
            query("#loginId")?.focus();
        } catch (error) {
            if (error?.name === "AbortError") return;
            Common.ui.setInlineStatus(status, error.message || "회원가입 신청을 저장하지 못했습니다.", "error");
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    }

    async function openAdminContact() {
        const dialog = query("#adminContactDialog");
        const status = query("#adminContactStatus");
        dialog?.showModal();
        Common.ui.setInlineStatus(status, "관리자 연락처를 확인하고 있습니다.");
        try {
            const payload = await Common.api.request("/auth/admin-contact", {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            const contact = Common.data.get(payload) || {};
            query("#adminContactName").textContent = Common.data.pick(contact, "name", "userName", "USER_NAME") || "시스템 관리자";
            query("#adminContactEmail").textContent = Common.data.pick(contact, "email", "EMAIL") || "-";
            query("#adminContactPhone").textContent = Common.data.pick(contact, "phone", "PHONE") || "-";
            Common.ui.setInlineStatus(status, "");
        } catch (error) {
            if (error?.name === "AbortError") return;
            Common.ui.setInlineStatus(status, error.message || "관리자 연락처를 확인하지 못했습니다.", "error");
        }
    }

    window.Pages.login = {
        init(context) {
            root = context.root;
            controller = new AbortController();
            query("#loginAppName").textContent = window.APP_NAME || "웹 사이트";
            applySkinContent();

            query("#loginForm")?.addEventListener("submit", submitLogin, { signal: controller.signal });
            query("#signupForm")?.addEventListener("submit", submitSignup, { signal: controller.signal });
            query("#signupRoleCode")?.addEventListener("change", syncAdminKeyField, { signal: controller.signal });
            query("#openSignupButton")?.addEventListener("click", () => {
                Common.ui.setInlineStatus(query("#signupStatus"), "");
                query("#signupDialog")?.showModal();
                query("#signupLoginId")?.focus();
            }, { signal: controller.signal });
            query("#openAdminContactButton")?.addEventListener("click", openAdminContact, { signal: controller.signal });
            root.querySelectorAll("[data-dialog-close]").forEach((button) => {
                button.addEventListener("click", () => closeDialog(button.closest("dialog")), { signal: controller.signal });
            });
            root.querySelectorAll("dialog").forEach((dialog) => {
                dialog.addEventListener("click", (event) => {
                    if (event.target === dialog) closeDialog(dialog);
                }, { signal: controller.signal });
            });
            window.addEventListener("app:homepage-skin-change", applySkinContent, {
                signal: controller.signal
            });
            syncAdminKeyField();
        },

        destroy() {
            controller?.abort();
            controller = null;
            root = null;
        }
    };
})();
