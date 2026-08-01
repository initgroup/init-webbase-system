(function() {
    "use strict";

    window.Pages = window.Pages || {};

    const state = {
        user: null,
        sessionChecked: false,
        handlingUnauthorized: false
    };

    const pageMap = new Map();
    const loadedScripts = new Map();
    const registeredHtmlPages = new Set(window.PAGE_FILE_CONFIG?.htmlPages || []);
    const registeredScriptPages = new Set(window.PAGE_FILE_CONFIG?.scriptPages || []);
    const VISITED_PAGES_STORAGE_KEY = "init-webbase:visited-pages";

    function collectPages(items = []) {
        items.forEach((item) => {
            if (item.type === "page" && item.page) pageMap.set(item.page, item);
            if (Array.isArray(item.children)) collectPages(item.children);
        });
    }

    collectPages(window.MENU_CONFIG || []);
    pageMap.set("login", { type: "page", page: "login", label: "로그인", title: "로그인", public: true });

    function loadVisitedPages() {
        try {
            const stored = JSON.parse(window.sessionStorage.getItem(VISITED_PAGES_STORAGE_KEY) || "[]");
            return new Set(
                Array.isArray(stored)
                    ? stored.filter((pageCode) => pageMap.has(String(pageCode)))
                    : []
            );
        } catch (_error) {
            return new Set();
        }
    }

    const visitedPages = loadVisitedPages();

    function saveVisitedPages() {
        try {
            window.sessionStorage.setItem(
                VISITED_PAGES_STORAGE_KEY,
                JSON.stringify(Array.from(visitedPages))
            );
        } catch (_error) {
            // Visited state is cosmetic and must not block navigation.
        }
    }

    function roleCode() {
        return String(state.user?.roleCode || "USER").toUpperCase();
    }

    function isAllowed(item) {
        const roles = Array.isArray(item?.roles) ? item.roles.map((value) => String(value).toUpperCase()) : [];
        return roles.length === 0 || roles.includes(roleCode());
    }

    function getPage(pageCode) {
        return pageMap.get(pageCode) || null;
    }

    function hasRegisteredPageFiles(pageCode) {
        return registeredHtmlPages.has(pageCode) && registeredScriptPages.has(pageCode);
    }

    function routeFromHash() {
        try {
            const value = decodeURIComponent(window.location.hash.replace(/^#\/?/, "")).trim();
            return pageMap.has(value) ? value : "";
        } catch (_error) {
            return "";
        }
    }

    function updateHash(pageCode, replace = false) {
        const next = `#/${pageCode}`;
        if (window.location.hash === next) return;
        const method = replace ? "replaceState" : "pushState";
        window.history[method]({ pageCode }, "", next);
    }

    function setSidebarOpen(open) {
        const mobile = window.matchMedia("(max-width: 1024px)").matches;
        const wasOpen = document.body.classList.contains("sidebar-open");
        const enabled = mobile && Boolean(open);
        const toggle = document.getElementById("sidebarToggle");
        const closeButton = document.getElementById("sidebarClose");
        const backdrop = document.getElementById("sidebarBackdrop");
        const sidebar = document.getElementById("appSidebar");
        const main = document.querySelector(".app-main");
        document.body.classList.toggle("sidebar-open", enabled);
        if (toggle) {
            toggle.setAttribute("aria-expanded", String(enabled));
            toggle.setAttribute("aria-label", enabled ? "메뉴 닫기" : "메뉴 열기");
        }
        if (backdrop) backdrop.hidden = !enabled;
        if (sidebar) {
            sidebar.inert = mobile && !enabled;
            sidebar.setAttribute("aria-hidden", String(mobile && !enabled));
        }
        if (main) main.inert = enabled;

        if (enabled) {
            window.requestAnimationFrame(() => closeButton?.focus());
        } else if (wasOpen && mobile) {
            window.requestAnimationFrame(() => toggle?.focus());
        }
    }

    function keepFocusInSidebar(event) {
        if (event.key !== "Tab" || !document.body.classList.contains("sidebar-open")) return;
        const sidebar = document.getElementById("appSidebar");
        const focusable = Array.from(sidebar?.querySelectorAll(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []).filter((element) => !element.hidden && element.getClientRects().length > 0);
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function pageLink(item) {
        const link = Common.dom.element("a", {
            className: "nav-link",
            attrs: {
                href: `#/${encodeURIComponent(item.page)}`,
                "data-page": item.page,
                "data-visited": visitedPages.has(item.page) ? "true" : null,
                "aria-current": PageManager.current?.pageCode === item.page ? "page" : null
            }
        });
        const icon = Common.dom.element("span", {
            className: "nav-icon",
            text: item.icon || "•",
            attrs: { "aria-hidden": "true" }
        });
        const label = Common.dom.element("span", { text: item.label || item.title || item.page });
        link.append(icon, label);
        link.addEventListener("click", (event) => {
            if (
                event.defaultPrevented
                || event.button !== 0
                || event.metaKey
                || event.ctrlKey
                || event.shiftKey
                || event.altKey
            ) {
                return;
            }
            event.preventDefault();
            App.navigate(item.page);
        });
        return link;
    }

    function renderNavigation() {
        const navigation = document.getElementById("appNavigation");
        if (!navigation) return;
        navigation.replaceChildren();
        if (!state.user) return;

        (window.MENU_CONFIG || []).forEach((item) => {
            if (item.type === "page") {
                if (isAllowed(item)) navigation.appendChild(pageLink(item));
                return;
            }

            if (item.type === "group") {
                if (!isAllowed(item)) return;
                const children = (item.children || []).filter(isAllowed);
                if (!children.length) return;

                const section = Common.dom.element("section", {
                    className: "nav-group",
                    attrs: { "aria-label": item.label || "메뉴 그룹" }
                });
                section.appendChild(Common.dom.element("span", {
                    className: "nav-group-label",
                    text: item.label || ""
                }));
                children.forEach((child) => section.appendChild(pageLink(child)));
                navigation.appendChild(section);
            }
        });
    }

    function updateNavigationState(pageCode) {
        const navigation = document.getElementById("appNavigation");
        if (!navigation) return;
        navigation.querySelectorAll(".nav-link[data-page]").forEach((link) => {
            const linkPage = link.dataset.page || "";
            if (linkPage === pageCode) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
            if (visitedPages.has(linkPage)) {
                link.dataset.visited = "true";
            } else {
                delete link.dataset.visited;
            }
        });
    }

    function markPageVisited(pageCode) {
        if (!pageMap.has(pageCode) || pageCode === "login") return;
        if (!visitedPages.has(pageCode)) {
            visitedPages.add(pageCode);
            saveVisitedPages();
        }
        updateNavigationState(pageCode);
    }

    function updateShell(pageCode) {
        const page = getPage(pageCode);
        const isLogin = pageCode === "login";
        const appName = window.APP_NAME || "웹 사이트";

        document.body.classList.toggle("auth-screen", isLogin);
        document.title = isLogin ? `로그인 · ${appName}` : `${page?.title || page?.label || appName} · ${appName}`;

        const title = document.getElementById("pageTitle");
        const eyebrow = document.getElementById("appHeaderEyebrow");
        const headerUser = document.getElementById("headerUserName");
        const sidebarUser = document.getElementById("sidebarUserName");
        const sidebarRole = document.getElementById("sidebarUserRole");

        if (title) title.textContent = page?.title || page?.label || "";
        if (eyebrow) eyebrow.textContent = appName;
        if (headerUser) headerUser.textContent = state.user?.userName || state.user?.loginId || "";
        if (sidebarUser) sidebarUser.textContent = state.user?.userName || state.user?.loginId || "로그인 사용자";
        if (sidebarRole) sidebarRole.textContent = roleCode() === "ADMIN" ? "관리자" : "사용자";

        updateNavigationState(pageCode);
    }

    function loadPageScript(pageCode) {
        if (window.Pages[pageCode]) return Promise.resolve(window.Pages[pageCode]);
        if (loadedScripts.has(pageCode)) return loadedScripts.get(pageCode);

        const promise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = `./js/${encodeURIComponent(pageCode)}.js`;
            script.async = true;
            script.dataset.pageScript = pageCode;
            script.addEventListener("load", () => {
                const pageModule = window.Pages[pageCode];
                if (!pageModule) {
                    reject(new Error(`${pageCode} 화면 모듈이 등록되지 않았습니다.`));
                    return;
                }
                resolve(pageModule);
            }, { once: true });
            script.addEventListener("error", () => {
                reject(new Error(`${pageCode} 화면 스크립트를 불러오지 못했습니다.`));
            }, { once: true });
            document.head.appendChild(script);
        }).catch((error) => {
            loadedScripts.delete(pageCode);
            throw error;
        });

        loadedScripts.set(pageCode, promise);
        return promise;
    }

    async function loadPageHtml(pageCode, signal) {
        const response = await fetch(`./pages/${encodeURIComponent(pageCode)}.html`, {
            method: "GET",
            credentials: "same-origin",
            cache: "no-cache",
            signal
        });
        if (!response.ok) throw new Error(`${pageCode} 화면을 불러오지 못했습니다. (HTTP ${response.status})`);
        return response.text();
    }

    const PageManager = {
        current: null,
        requestId: 0,
        controller: null,

        async destroyCurrent() {
            const current = this.current;
            this.current = null;
            if (!current?.module?.destroy) return;
            try {
                await current.module.destroy();
            } catch (error) {
                console.warn("[PageManager] 화면 정리 중 오류가 발생했습니다.", error);
            }
        },

        async load(requestedPageCode, options = {}) {
            let pageCode = String(requestedPageCode || "").trim();
            let page = getPage(pageCode);

            if (!state.user && pageCode !== "login") {
                pageCode = "login";
                page = getPage(pageCode);
            } else if (state.user && pageCode === "login") {
                pageCode = "home";
                page = getPage(pageCode);
            }

            if (!page) {
                pageCode = state.user ? "home" : "login";
                page = getPage(pageCode);
            }

            if (!hasRegisteredPageFiles(pageCode)) {
                Common.ui.toast("등록되지 않은 화면입니다.", "error");
                pageCode = state.user ? "home" : "login";
                page = getPage(pageCode);
            }

            if (!isAllowed(page)) {
                Common.ui.toast("이 메뉴에 접근할 권한이 없습니다.", "warning");
                pageCode = "home";
                page = getPage(pageCode);
            }

            if (this.current?.pageCode === pageCode && !options.force) {
                if (options.fromHash && routeFromHash() !== pageCode) {
                    updateHash(pageCode, true);
                }
                setSidebarOpen(false);
                return;
            }

            const requestId = ++this.requestId;
            this.controller?.abort();
            this.controller = new AbortController();
            Common.ui.showLoading("화면을 불러오고 있습니다.");

            try {
                const [html, pageModule] = await Promise.all([
                    loadPageHtml(pageCode, this.controller.signal),
                    loadPageScript(pageCode)
                ]);
                if (requestId !== this.requestId) return;

                await this.destroyCurrent();
                if (requestId !== this.requestId) return;

                const host = document.getElementById("pageHost");
                host.innerHTML = html;
                const root = host.firstElementChild || host;
                this.current = { pageCode, module: pageModule, root };

                markPageVisited(pageCode);
                updateShell(pageCode);
                if (!options.fromHash) {
                    updateHash(pageCode, options.replaceHash);
                } else if (routeFromHash() !== pageCode) {
                    updateHash(pageCode, true);
                }
                setSidebarOpen(false);

                if (typeof pageModule.init === "function") {
                    await pageModule.init({
                        root,
                        user: state.user,
                        navigate: App.navigate,
                        refreshSession: App.refreshSession
                    });
                }
                if (requestId !== this.requestId) return;

                const explicitFocusTarget = root.querySelector("[data-page-focus]");
                const focusTarget = explicitFocusTarget || root.querySelector("h1, h2") || host;
                if (!explicitFocusTarget) focusTarget.setAttribute?.("tabindex", "-1");
                focusTarget.focus?.({ preventScroll: true });
                window.scrollTo({ top: 0, behavior: "auto" });
            } catch (error) {
                if (error?.name === "AbortError") return;
                console.error("[PageManager] 화면 로드 실패", error);
                Common.ui.toast(error.message || "화면을 불러오지 못했습니다.", "error", { duration: 0 });

                const fallback = state.user ? "home" : "login";
                if (pageCode !== fallback) {
                    await this.load(fallback, { replaceHash: true });
                }
            } finally {
                Common.ui.hideLoading();
            }
        },

        refresh() {
            if (!this.current?.pageCode) return Promise.resolve();
            return this.load(this.current.pageCode, { force: true, replaceHash: true });
        }
    };

    async function refreshSession(options = {}) {
        try {
            const payload = await Common.api.request("/auth/session", {
                method: "GET",
                showLoading: options.showLoading === true
            });
            state.user = Common.data.normalizeUser(payload);
        } catch (error) {
            if (!(error instanceof Common.ApiError) || error.status !== 401) {
                if (!options.silent) Common.ui.toast(error.message || "세션을 확인하지 못했습니다.", "error");
            }
            state.user = null;
        } finally {
            state.sessionChecked = true;
            renderNavigation();
        }
        return state.user;
    }

    async function logout() {
        try {
            await Common.api.request("/auth/logout", {
                method: "POST",
                loadingMessage: "로그아웃하고 있습니다."
            });
        } catch (error) {
            if (!(error instanceof Common.ApiError) || error.status !== 401) {
                Common.ui.toast(error.message || "로그아웃하지 못했습니다.", "error");
                return;
            }
        }

        state.user = null;
        renderNavigation();
        await PageManager.load("login", { replaceHash: true });
        Common.ui.toast("로그아웃했습니다.", "success");
    }

    const App = {
        navigate(pageCode, options = {}) {
            return PageManager.load(pageCode, options);
        },
        refreshPage() {
            return PageManager.refresh();
        },
        refreshSession,
        logout,
        getUser() {
            return state.user ? { ...state.user } : null;
        },
        setSessionUser(user) {
            state.user = Common.data.normalizeUser(user);
            renderNavigation();
            if (PageManager.current?.pageCode) updateShell(PageManager.current.pageCode);
            return state.user;
        },
        isAdmin() {
            return roleCode() === "ADMIN";
        },
        touchSessionFromResponse() {
            // Authentication state is owned by the HttpOnly server session cookie.
        },
        PageManager
    };

    window.App = App;

    async function handleUnauthorized() {
        if (!state.sessionChecked || state.handlingUnauthorized || PageManager.current?.pageCode === "login") return;
        state.handlingUnauthorized = true;
        try {
            state.user = null;
            renderNavigation();
            Common.ui.toast("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.", "warning");
            await PageManager.load("login", { replaceHash: true });
        } finally {
            state.handlingUnauthorized = false;
        }
    }

    function bindShellEvents() {
        document.getElementById("sidebarToggle")?.addEventListener("click", () => {
            setSidebarOpen(!document.body.classList.contains("sidebar-open"));
        });
        document.getElementById("sidebarBackdrop")?.addEventListener("click", () => setSidebarOpen(false));
        document.getElementById("sidebarClose")?.addEventListener("click", () => setSidebarOpen(false));
        document.getElementById("refreshPageButton")?.addEventListener("click", () => App.refreshPage());
        document.getElementById("logoutButton")?.addEventListener("click", () => App.logout());

        window.addEventListener("popstate", () => {
            const pageCode = routeFromHash() || (state.user ? "home" : "login");
            PageManager.load(pageCode, { fromHash: true });
        });
        window.addEventListener("app:unauthorized", handleUnauthorized);
        window.addEventListener("resize", () => {
            setSidebarOpen(document.body.classList.contains("sidebar-open"));
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") setSidebarOpen(false);
            keepFocusInSidebar(event);
        });
        setSidebarOpen(false);
    }

    async function boot() {
        const appName = window.APP_NAME || "웹 사이트";
        const brandName = document.getElementById("appBrandName");
        if (brandName) brandName.textContent = appName;
        bindShellEvents();

        await refreshSession({ silent: true });
        const requested = routeFromHash();
        const initialPage = state.user
            ? (requested && requested !== "login" ? requested : "home")
            : "login";

        await PageManager.load(initialPage, {
            fromHash: window.location.hash === `#/${initialPage}`,
            replaceHash: true
        });
        document.body.classList.remove("app-booting");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();
