(function() {
    "use strict";

    const SITE_ORIGIN = "https://initgroup.kr";
    const MOBILE_QUERY = window.matchMedia("(max-width: 1080px)");
    const VISITED_STORAGE_KEY = "init-public-visited-routes";
    const LEGACY_PORTAL_PAGES = new Set([
        "login",
        "home",
        "account",
        "admin-users",
        "admin-notices",
        "admin-site-settings"
    ]);
    const ALLOWED_SKINS = new Set([
        "national-intelligence",
        "data-spectrum",
        "public-insight"
    ]);
    const ROUTES = new Map([
        ["/", {
            label: "홈",
            title: "인아이티 | AI 기반 데이터 통계 전문기업",
            description: "인아이티는 국가통계와 공공·산업 데이터를 AI 및 통계 기술로 연결해 신뢰할 수 있는 의사결정을 만드는 데이터 전문기업입니다."
        }],
        ["/company", {
            label: "회사소개",
            title: "회사소개 | 인아이티",
            description: "2013년부터 이어온 인아이티의 데이터 전문성, 비전, 연혁과 기술 기반을 소개합니다."
        }],
        ["/business", {
            label: "서비스",
            title: "서비스 | 인아이티",
            description: "데이터 전략과 품질, AI·통계 분석, 시각화, 시스템 구축과 운영을 하나의 흐름으로 제공합니다."
        }],
        ["/solutions", {
            label: "솔루션",
            title: "솔루션 | 인아이티",
            description: "설명 가능한 데이터 품질 플랫폼 INIT Data Editing System과 인법스 데이터 플랫폼을 소개합니다."
        }],
        ["/projects", {
            label: "프로젝트",
            title: "프로젝트 | 인아이티",
            description: "국가통계, 공공행정, 금융, 제조와 연구 분야에서 축적한 인아이티의 데이터 프로젝트 경험입니다."
        }],
        ["/insights", {
            label: "인사이트",
            title: "인사이트 | 인아이티",
            description: "AI와 통계를 현장에 적용할 때 필요한 데이터 품질, 설명 가능성과 운영 원칙을 공유합니다."
        }],
        ["/careers", {
            label: "채용",
            title: "채용 | 인아이티",
            description: "데이터의 가능성을 함께 발견하고 신뢰할 수 있는 서비스를 만들 인아이티의 동료를 기다립니다."
        }],
        ["/contact", {
            label: "문의하기",
            title: "문의하기 | 인아이티",
            description: "AI·통계 분석, 데이터 품질, 시스템 구축과 솔루션 도입에 관해 인아이티에 문의하세요."
        }]
    ]);

    const state = {
        currentRoute: "",
        menuOpen: false,
        initialized: false,
        visitedRoutes: loadVisitedRoutes()
    };

    const elements = {};

    function normalizePath(pathname) {
        let value = String(pathname || "/").trim();
        try {
            value = decodeURIComponent(value);
        } catch (_error) {
            value = "/";
        }
        value = value.replace(/\/{2,}/g, "/");
        if (value === "/index.html" || value === "/public" || value === "/public/") return "/";
        if (value.length > 1) value = value.replace(/\/+$/, "");
        return value || "/";
    }

    function loadVisitedRoutes() {
        try {
            const parsed = JSON.parse(window.sessionStorage.getItem(VISITED_STORAGE_KEY) || "[]");
            return new Set(
                Array.isArray(parsed)
                    ? parsed.map(normalizePath).filter((route) => ROUTES.has(route))
                    : []
            );
        } catch (_error) {
            return new Set();
        }
    }

    function saveVisitedRoutes() {
        try {
            window.sessionStorage.setItem(
                VISITED_STORAGE_KEY,
                JSON.stringify(Array.from(state.visitedRoutes))
            );
        } catch (_error) {
            // Visited styling is cosmetic and must not block navigation.
        }
    }

    function rememberRoute(route) {
        if (!ROUTES.has(route)) return;
        state.visitedRoutes.add(route);
        saveVisitedRoutes();
    }

    function routeLinks() {
        return Array.from(document.querySelectorAll("a[data-site-route]"));
    }

    function updateNavigationState(route) {
        routeLinks().forEach((link) => {
            const linkRoute = normalizePath(new URL(link.href, window.location.href).pathname);
            const isCurrent = linkRoute === route;
            if (isCurrent) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
            if (state.visitedRoutes.has(linkRoute)) {
                link.dataset.visited = "true";
            } else {
                delete link.dataset.visited;
            }
        });
    }

    function updateMetadata(route) {
        const metadata = ROUTES.get(route) || {
            label: "페이지 없음",
            title: "페이지를 찾을 수 없습니다 | 인아이티",
            description: "요청한 인아이티 홈페이지를 찾을 수 없습니다."
        };
        document.title = metadata.title;

        const description = document.querySelector('meta[name="description"]');
        const ogTitle = document.querySelector('meta[property="og:title"]');
        const ogDescription = document.querySelector('meta[property="og:description"]');
        const ogUrl = document.querySelector('meta[property="og:url"]');
        const canonical = document.getElementById("siteCanonical");
        const canonicalUrl = `${SITE_ORIGIN}${route === "/" ? "/" : route}`;

        if (description) description.content = metadata.description;
        if (ogTitle) ogTitle.content = metadata.title;
        if (ogDescription) ogDescription.content = metadata.description;
        if (ogUrl) ogUrl.content = canonicalUrl;
        if (canonical) canonical.href = canonicalUrl;
    }

    function updateHeader() {
        const scrolled = window.scrollY > 18;
        const isNotFound = state.currentRoute === "/404";
        elements.header?.classList.toggle("is-scrolled", scrolled);
        elements.header?.classList.toggle("is-light-context", isNotFound && !scrolled);
    }

    function saveCurrentScrollPosition() {
        if (!state.currentRoute) return;
        const currentState = window.history.state || {};
        window.history.replaceState(
            {
                ...currentState,
                route: state.currentRoute,
                scrollY: window.scrollY
            },
            "",
            window.location.href
        );
    }

    function announceRoute(route) {
        const metadata = ROUTES.get(route);
        if (!elements.routeStatus || !metadata) return;
        elements.routeStatus.textContent = `${metadata.label} 화면으로 이동했습니다.`;
    }

    function activeViewFor(route) {
        return document.querySelector(`.site-view[data-route="${route}"]`)
            || document.querySelector('.site-not-found[data-route="/404"]');
    }

    function focusView(view) {
        const target = view?.querySelector("h1") || elements.main;
        if (!target) return;
        const hadTabIndex = target.hasAttribute("tabindex");
        if (!hadTabIndex) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
        if (!hadTabIndex) {
            target.addEventListener("blur", () => target.removeAttribute("tabindex"), {
                once: true
            });
        }
    }

    function activateRoute(requestedRoute, options = {}) {
        const normalized = normalizePath(requestedRoute);
        const route = ROUTES.has(normalized) ? normalized : "/404";

        if (state.initialized && route === state.currentRoute) {
            closeMenu({ restoreFocus: false });
            return false;
        }

        if (options.history === "push") {
            saveCurrentScrollPosition();
            window.history.pushState({ route, scrollY: 0 }, "", normalized);
        } else if (options.history === "replace") {
            window.history.replaceState({ route, scrollY: 0 }, "", normalized);
        }

        const previousView = document.querySelector(".site-view.is-active, .site-not-found.is-active");
        const nextView = activeViewFor(route);
        if (previousView && previousView !== nextView) {
            previousView.classList.remove("is-active", "is-entering");
            previousView.hidden = true;
            previousView.inert = true;
            previousView.setAttribute("aria-hidden", "true");
        }

        if (nextView) {
            nextView.hidden = false;
            nextView.inert = false;
            nextView.removeAttribute("aria-hidden");
            nextView.classList.add("is-active");
            if (state.initialized) {
                nextView.classList.remove("is-entering");
                window.requestAnimationFrame(() => nextView.classList.add("is-entering"));
            }
        }

        state.currentRoute = route;
        rememberRoute(normalized);
        updateNavigationState(normalized);
        updateMetadata(route);
        updateHeader();
        closeMenu({ restoreFocus: false });

        if (options.scrollY !== undefined) {
            window.scrollTo({ top: Number(options.scrollY) || 0, behavior: "auto" });
        } else if (state.initialized) {
            window.scrollTo({ top: 0, behavior: "auto" });
        }

        if (state.initialized && options.focus !== false) {
            focusView(nextView);
            announceRoute(route);
        }

        state.initialized = true;
        return true;
    }

    function menuFocusableElements() {
        return Array.from(elements.navigation?.querySelectorAll(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []).filter((element) => !element.hidden && element.getClientRects().length > 0);
    }

    function setBackgroundInert(inert) {
        if (elements.main) elements.main.inert = inert;
        if (elements.footer) elements.footer.inert = inert;
    }

    function openMenu() {
        if (!MOBILE_QUERY.matches || state.menuOpen) return;
        state.menuOpen = true;
        document.body.classList.add("site-menu-open");
        elements.menuToggle?.setAttribute("aria-expanded", "true");
        elements.menuToggle?.setAttribute("aria-label", "전체 메뉴 닫기");
        if (elements.backdrop) elements.backdrop.hidden = false;
        if (elements.navigation) {
            elements.navigation.inert = false;
            elements.navigation.removeAttribute("aria-hidden");
        }
        setBackgroundInert(true);
        window.requestAnimationFrame(() => {
            (elements.menuClose || menuFocusableElements()[0])?.focus();
        });
    }

    function closeMenu(options = {}) {
        const wasOpen = state.menuOpen;
        state.menuOpen = false;
        document.body.classList.remove("site-menu-open");
        elements.menuToggle?.setAttribute("aria-expanded", "false");
        elements.menuToggle?.setAttribute("aria-label", "전체 메뉴 열기");
        if (elements.backdrop) elements.backdrop.hidden = true;
        if (elements.navigation && MOBILE_QUERY.matches) {
            elements.navigation.inert = true;
            elements.navigation.setAttribute("aria-hidden", "true");
        } else if (elements.navigation) {
            elements.navigation.inert = false;
            elements.navigation.removeAttribute("aria-hidden");
        }
        setBackgroundInert(false);
        if (wasOpen && options.restoreFocus !== false) {
            window.requestAnimationFrame(() => elements.menuToggle?.focus());
        }
    }

    function handleMenuKeydown(event) {
        if (!state.menuOpen) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closeMenu();
            return;
        }
        if (event.key !== "Tab") return;

        const focusable = menuFocusableElements();
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

    function canHandleRouteClick(event, anchor) {
        if (
            event.defaultPrevented
            || event.button !== 0
            || event.metaKey
            || event.ctrlKey
            || event.shiftKey
            || event.altKey
            || anchor.target
            || anchor.hasAttribute("download")
        ) {
            return false;
        }
        const url = new URL(anchor.href, window.location.href);
        return url.origin === window.location.origin && ROUTES.has(normalizePath(url.pathname));
    }

    function bindRouteLinks() {
        document.addEventListener("click", (event) => {
            const anchor = event.target.closest("a[data-site-route]");
            if (!anchor || !canHandleRouteClick(event, anchor)) return;
            event.preventDefault();
            const route = normalizePath(new URL(anchor.href, window.location.href).pathname);
            activateRoute(route, { history: "push" });
        });

        window.addEventListener("popstate", (event) => {
            activateRoute(window.location.pathname, {
                history: "none",
                scrollY: event.state?.scrollY ?? 0
            });
        });

        window.addEventListener("beforeunload", saveCurrentScrollPosition);
    }

    function bindMenu() {
        elements.menuToggle?.addEventListener("click", () => {
            if (state.menuOpen) closeMenu();
            else openMenu();
        });
        elements.menuClose?.addEventListener("click", () => closeMenu());
        elements.backdrop?.addEventListener("click", () => closeMenu());
        document.addEventListener("keydown", handleMenuKeydown);

        const handleBreakpointChange = () => {
            if (!MOBILE_QUERY.matches) {
                closeMenu({ restoreFocus: false });
            } else if (elements.navigation && !state.menuOpen) {
                elements.navigation.inert = true;
                elements.navigation.setAttribute("aria-hidden", "true");
            }
        };
        if (typeof MOBILE_QUERY.addEventListener === "function") {
            MOBILE_QUERY.addEventListener("change", handleBreakpointChange);
        } else {
            MOBILE_QUERY.addListener(handleBreakpointChange);
        }
        handleBreakpointChange();
    }

    function bindHeader() {
        let frameRequested = false;
        window.addEventListener("scroll", () => {
            if (frameRequested) return;
            frameRequested = true;
            window.requestAnimationFrame(() => {
                updateHeader();
                frameRequested = false;
            });
        }, { passive: true });
    }

    function bindProductGallery() {
        const dialog = document.getElementById("productScreenshotDialog");
        const image = document.getElementById("productLightboxImage");
        const title = document.getElementById("productLightboxTitle");
        const description = document.getElementById("productLightboxDescription");
        const closeButton = dialog?.querySelector("[data-product-shot-close]");
        const triggers = document.querySelectorAll("[data-product-shot]");
        let returnFocus = null;

        if (!dialog || !image || !title || !description || !triggers.length) return;

        const closeDialog = () => {
            if (dialog.open) dialog.close();
        };

        triggers.forEach((trigger) => {
            trigger.addEventListener("click", () => {
                const source = trigger.dataset.shotSrc;
                if (!source) return;
                if (typeof dialog.showModal !== "function") {
                    window.open(source, "_blank", "noopener,noreferrer");
                    return;
                }

                returnFocus = trigger;
                image.src = source;
                image.alt = `${trigger.dataset.shotTitle || "제품"} 실제 화면 원본`;
                title.textContent = trigger.dataset.shotTitle || "제품 화면";
                description.textContent = trigger.dataset.shotDescription || "";
                document.body.classList.add("product-lightbox-open");
                dialog.showModal();
                window.requestAnimationFrame(() => closeButton?.focus());
            });
        });

        closeButton?.addEventListener("click", closeDialog);
        dialog.addEventListener("click", (event) => {
            if (event.target === dialog) closeDialog();
        });
        dialog.addEventListener("close", () => {
            document.body.classList.remove("product-lightbox-open");
            returnFocus?.focus();
            returnFocus = null;
        });
    }

    async function loadSiteSkin() {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 3500);
        try {
            const response = await fetch("/api/site/preferences", {
                method: "GET",
                credentials: "same-origin",
                headers: { Accept: "application/json" },
                signal: controller.signal
            });
            if (!response.ok) return;
            const payload = await response.json();
            const skin = String(payload?.data?.homepageSkin || "").trim().toLowerCase();
            if (ALLOWED_SKINS.has(skin)) {
                document.documentElement.dataset.homeSkin = skin;
            }
        } catch (_error) {
            // The static homepage remains usable with its default skin.
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    function collectElements() {
        elements.header = document.getElementById("siteHeader");
        elements.navigation = document.getElementById("siteNavigation");
        elements.menuToggle = document.getElementById("siteMenuToggle");
        elements.menuClose = document.getElementById("siteMenuClose");
        elements.backdrop = document.getElementById("siteMenuBackdrop");
        elements.main = document.getElementById("siteMain");
        elements.footer = document.getElementById("siteFooter");
        elements.routeStatus = document.getElementById("siteRouteStatus");
    }

    function redirectLegacyPortalHash() {
        if (normalizePath(window.location.pathname) !== "/") return false;
        try {
            const pageCode = decodeURIComponent(
                window.location.hash.replace(/^#\/?/, "")
            ).trim();
            if (!LEGACY_PORTAL_PAGES.has(pageCode)) return false;
            window.location.replace(`/app#/${encodeURIComponent(pageCode)}`);
            return true;
        } catch (_error) {
            return false;
        }
    }

    function initializeViews() {
        document.querySelectorAll(".site-view, .site-not-found").forEach((view) => {
            view.hidden = true;
            view.inert = true;
            view.setAttribute("aria-hidden", "true");
        });
    }

    function boot() {
        if (redirectLegacyPortalHash()) return;
        collectElements();
        initializeViews();
        bindRouteLinks();
        bindMenu();
        bindHeader();
        bindProductGallery();

        const year = document.getElementById("siteCopyrightYear");
        if (year) year.textContent = String(new Date().getFullYear());

        const initialRoute = normalizePath(window.location.pathname);
        activateRoute(initialRoute, {
            history: ROUTES.has(initialRoute) ? "replace" : "none",
            focus: false,
            scrollY: window.history.state?.scrollY ?? window.scrollY
        });
        loadSiteSkin();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();
