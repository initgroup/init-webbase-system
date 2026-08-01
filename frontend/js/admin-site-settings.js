(function() {
    "use strict";

    const PAGE_NAME = "admin-site-settings";
    let controller = null;
    let root = null;
    let committedSkin = "";
    let selectedSkin = "";

    function query(selector) {
        return root?.querySelector(selector) || null;
    }

    function templates() {
        return App.getHomepageSkinTemplates();
    }

    function setStatus(message, type = "") {
        Common.ui.setInlineStatus(query("#siteSettingsStatus"), message, type);
    }

    function selectSkin(skinCode) {
        if (!templates().some((template) => template.code === skinCode)) return;
        selectedSkin = skinCode;
        App.applyHomepageSkin(skinCode);
        root.querySelectorAll('input[name="homepageSkin"]').forEach((input) => {
            input.checked = input.value === skinCode;
            input.closest(".skin-template-card")?.classList.toggle("is-selected", input.checked);
        });
        setStatus(
            skinCode === committedSkin
                ? "현재 저장된 스킨입니다."
                : "미리보기 중입니다. 전체 적용하려면 저장해 주세요."
        );
    }

    function renderTemplates() {
        const container = query("#homepageSkinTemplates");
        Common.dom.clear(container);

        templates().forEach((template) => {
            const label = Common.dom.element("label", { className: "skin-template-card" });
            const input = Common.dom.element("input", {
                type: "radio",
                value: template.code,
                attrs: {
                    name: "homepageSkin",
                    "aria-label": `${template.name} 스킨`
                }
            });
            const preview = Common.dom.element("span", { className: "skin-template-preview" });
            preview.style.setProperty("--preview-start", template.colors[0]);
            preview.style.setProperty("--preview-middle", template.colors[1]);
            preview.style.setProperty("--preview-accent", template.colors[2]);
            preview.append(
                Common.dom.element("span", { className: "skin-template-preview-brand", text: "INIT" }),
                Common.dom.element("span", { className: "skin-template-preview-signal" }),
                Common.dom.element("span", { className: "skin-template-preview-card" })
            );

            const copy = Common.dom.element("span", { className: "skin-template-copy" });
            const heading = Common.dom.element("span", { className: "skin-template-heading" });
            heading.append(
                Common.dom.element("strong", { text: template.name }),
                Common.dom.element("small", { className: "skin-template-badge", text: template.badge })
            );
            copy.append(
                heading,
                Common.dom.element("span", {
                    className: "skin-template-description",
                    text: template.description
                })
            );
            input.addEventListener("change", () => selectSkin(template.code), {
                signal: controller.signal
            });
            label.append(input, preview, copy);
            container.appendChild(label);
        });
        selectSkin(selectedSkin);
    }

    async function loadSettings() {
        setStatus("디자인 설정을 불러오고 있습니다.");
        try {
            const payload = await Common.api.request("/admin/site-settings", {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            const data = Common.data.get(payload) || {};
            committedSkin = data.homepageSkin || App.getSitePreferences().homepageSkin;
            selectedSkin = committedSkin;
            renderTemplates();
            setStatus(data.configured ? "현재 저장된 스킨입니다." : "기본 스킨을 사용하고 있습니다.");
        } catch (error) {
            if (error?.name === "AbortError") return;
            committedSkin = App.getSitePreferences().homepageSkin;
            selectedSkin = committedSkin;
            renderTemplates();
            setStatus(error.message || "디자인 설정을 불러오지 못했습니다.", "error");
        }
    }

    async function saveSettings(event) {
        event.preventDefault();
        setStatus("");
        try {
            const payload = await Common.api.request("/admin/site-settings", {
                method: "PUT",
                body: { homepageSkin: selectedSkin },
                signal: controller.signal,
                loadingMessage: "디자인 스킨을 저장하고 있습니다."
            });
            const data = Common.data.get(payload) || {};
            committedSkin = data.homepageSkin || selectedSkin;
            selectedSkin = committedSkin;
            App.applyHomepageSkin(committedSkin);
            renderTemplates();
            setStatus("디자인 스킨을 저장했습니다.", "success");
            Common.ui.toast("포털 디자인 스킨을 적용했습니다.", "success");
        } catch (error) {
            if (error?.name !== "AbortError") {
                setStatus(error.message || "디자인 스킨을 저장하지 못했습니다.", "error");
            }
        }
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init({ root: pageRoot }) {
            root = pageRoot;
            controller = new AbortController();
            committedSkin = App.getSitePreferences().homepageSkin;
            selectedSkin = committedSkin;
            query("#siteSettingsForm")?.addEventListener("submit", saveSettings, {
                signal: controller.signal
            });
            query("#resetSkinPreviewButton")?.addEventListener("click", () => {
                selectSkin(committedSkin);
            }, { signal: controller.signal });
            await loadSettings();
        },

        destroy() {
            if (committedSkin) App.applyHomepageSkin(committedSkin);
            controller?.abort();
            controller = null;
            root = null;
            committedSkin = "";
            selectedSkin = "";
        }
    };
})();
