(function() {
    "use strict";

    const SVG_NS = "http://www.w3.org/2000/svg";
    const NOTICE_TYPE_LABELS = {
        INFO: "안내",
        IMPORTANT: "중요",
        WARNING: "주의",
        MAINTENANCE: "점검"
    };

    let controller = null;
    let root = null;

    function query(selector) {
        return root?.querySelector(selector) || null;
    }

    function pick(source, ...keys) {
        return Common.data.pick(source, ...keys);
    }

    function number(source, ...keys) {
        const value = Number(pick(source, ...keys) || 0);
        return Number.isFinite(value) ? value : 0;
    }

    function formattedNumber(value) {
        const numeric = Number(value || 0);
        return Number.isFinite(numeric) ? numeric.toLocaleString("ko-KR") : "0";
    }

    function formattedPercent(value, fractionDigits = 1) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(fractionDigits)}%` : "-";
    }

    function svgElement(tagName, attributes = {}) {
        const node = document.createElementNS(SVG_NS, tagName);
        Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)));
        return node;
    }

    function noticeValue(notice, ...keys) {
        return pick(notice, ...keys);
    }

    function renderAttachments(container, notice) {
        const files = noticeValue(notice, "files", "FILES", "attachments", "ATTACHMENTS") || [];
        if (!Array.isArray(files) || files.length === 0) return;

        files.forEach((file) => {
            const fileId = noticeValue(file, "fileId", "FILE_ID", "id", "ID");
            if (!fileId) return;
            const fileName = noticeValue(file, "fileName", "FILE_NAME", "name", "NAME") || "첨부 파일";
            const button = Common.dom.element("button", {
                className: "attachment-button",
                text: `첨부 · ${fileName}`,
                type: "button"
            });
            button.addEventListener("click", () => {
                Common.api.download(`/home/notice-files/${encodeURIComponent(fileId)}/download`, fileName)
                    .catch((error) => Common.ui.toast(error.message || "첨부 파일을 내려받지 못했습니다.", "error"));
            }, { signal: controller.signal });
            container.appendChild(button);
        });
    }

    function renderNotices(notices) {
        const list = query("#homeNoticeList");
        Common.dom.clear(list);
        const rows = Array.isArray(notices) ? notices : [];
        query("#homeNoticeSummary").textContent = `${formattedNumber(rows.length)}건`;
        if (!rows.length) {
            list.appendChild(Common.dom.element("div", {
                className: "empty-state dashboard-empty-state",
                text: "게시된 공지사항이 없습니다."
            }));
            return;
        }

        rows.forEach((notice, index) => {
            const details = Common.dom.element("details", { className: "notice-card" });
            if (index === 0) details.open = true;

            const summary = Common.dom.element("summary");
            const title = Common.dom.element("span", {
                text: noticeValue(notice, "title", "TITLE") || "제목 없음"
            });
            const metaText = Common.format.dateTime(
                noticeValue(notice, "postStartAt", "POST_START_AT", "createdAt", "CREATED_AT")
            );
            summary.appendChild(title);
            if (metaText && metaText !== "-") {
                summary.appendChild(Common.dom.element("span", {
                    className: "notice-meta",
                    text: metaText
                }));
            }

            const body = Common.dom.element("div", { className: "notice-body" });
            body.appendChild(Common.dom.element("p", {
                className: "notice-content",
                text: noticeValue(notice, "content", "CONTENT") || ""
            }));
            const attachments = Common.dom.element("div", { className: "attachment-list" });
            renderAttachments(attachments, notice);
            body.appendChild(attachments);
            details.append(summary, body);
            list.appendChild(details);
        });
    }

    function renderAiTrend(aiTraining = {}) {
        const trend = Array.isArray(aiTraining.trend) ? aiTraining.trend : [];
        const isEmpty = trend.length === 0;
        const badge = query("#aiTrendMode");
        const chart = query("#aiTrendChart");
        const emptyState = query("#aiTrendEmpty");
        badge.textContent = isEmpty ? "실데이터 대기" : `실데이터 ${trend.length}회`;
        badge.classList.toggle("is-empty", isEmpty);
        chart.hidden = isEmpty;
        emptyState.hidden = !isEmpty;

        const dataGroup = query("#aiTrendChartData");
        const labels = query("#aiTrendLabels");
        Common.dom.clear(dataGroup);
        Common.dom.clear(labels);

        if (isEmpty) {
            query("#aiLatestAccuracy").textContent = "연동 대기";
            query("#aiAverageAccuracy").textContent = "-";
            query("#aiDatasetRows").textContent = "-";
            return;
        }

        const left = 18;
        const right = 702;
        const top = 24;
        const bottom = 216;
        const chartWidth = right - left;
        const chartHeight = bottom - top;
        const points = trend.map((item, index) => {
            const accuracy = Math.min(1, Math.max(0.5, Number(item.accuracyScore || 0.5)));
            return {
                x: trend.length === 1 ? (left + right) / 2 : left + (chartWidth * index) / (trend.length - 1),
                y: bottom - ((accuracy - 0.5) / 0.5) * chartHeight,
                accuracy,
                item
            };
        });

        const linePath = points.map((point, index) => (
            `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
        )).join(" ");
        const areaPath = `${linePath} L ${points.at(-1).x.toFixed(2)} ${bottom} L ${points[0].x.toFixed(2)} ${bottom} Z`;
        dataGroup.append(
            svgElement("path", { class: "ai-chart-area", d: areaPath }),
            svgElement("path", { class: "ai-chart-line", d: linePath })
        );

        points.forEach((point, index) => {
            const circle = svgElement("circle", {
                class: "ai-chart-point",
                cx: point.x,
                cy: point.y,
                r: 5
            });
            const title = svgElement("title");
            title.textContent = `${point.item.modelName || "AI 모델"} ${point.item.modelVersion || index + 1}: ${formattedPercent(point.accuracy)}`;
            circle.appendChild(title);
            dataGroup.appendChild(circle);
            labels.appendChild(Common.dom.element("span", {
                text: point.item.modelVersion || `RUN ${index + 1}`
            }));
        });

        const latest = trend.at(-1);
        chart.setAttribute(
            "aria-label",
            `AI 학습 정확도 ${trend.length}회 추이, 최근 정확도 ${formattedPercent(latest.accuracyScore)}`
        );
        query("#aiLatestAccuracy").textContent = formattedPercent(latest.accuracyScore);
        query("#aiAverageAccuracy").textContent = formattedPercent(aiTraining.averageAccuracy);
        query("#aiDatasetRows").textContent = formattedNumber(latest.datasetRowCount);
    }

    function renderAiOperations(aiTraining = {}) {
        const total = number(aiTraining, "totalCount");
        const completed = number(aiTraining, "completedCount");
        const active = number(aiTraining, "activeCount");
        const failed = number(aiTraining, "failedCount");
        const completedAngle = total ? (completed / total) * 360 : 0;
        const activeAngle = total ? completedAngle + (active / total) * 360 : 0;
        const donut = query("#aiStatusDonut");
        const statusList = query("#aiStatusList");
        const emptyState = query("#aiOperationEmpty");
        const operationVisual = query("#aiOperationVisual");

        query("#aiTotalRuns").textContent = formattedNumber(total);
        query("#aiCompletedRuns").textContent = formattedNumber(completed);
        query("#aiActiveRuns").textContent = formattedNumber(active);
        query("#aiFailedRuns").textContent = formattedNumber(failed);
        donut.style.setProperty("--donut-completed", `${completedAngle}deg`);
        donut.style.setProperty("--donut-active", `${activeAngle}deg`);
        donut.classList.toggle("is-empty", total === 0);
        donut.hidden = total === 0;
        statusList.hidden = total === 0;
        emptyState.hidden = total > 0;
        operationVisual.classList.toggle("is-empty-state", total === 0);
        donut.setAttribute(
            "aria-label",
            `AI 학습 전체 ${total}회, 완료 ${completed}회, 진행 ${active}회, 실패 ${failed}회`
        );

        const tableAvailable = aiTraining.tableAvailable !== false;
        const integration = query("#aiIntegrationStatus");
        if (!tableAvailable) {
            query("#aiOperationEmptyTitle").textContent = "학습 데이터 연결 필요";
            query("#aiOperationEmptyDescription").textContent = "증분 DDL 적용 후 학습 파이프라인 실행 이력을 연결할 수 있습니다.";
            integration.className = "dashboard-integration-note is-warning";
            integration.textContent = "AI 학습 테이블 설치가 필요합니다. INIT_SYSTEM_ALT.sql을 적용해 주세요.";
        } else if (!total) {
            query("#aiOperationEmptyTitle").textContent = "첫 학습 실행 대기";
            query("#aiOperationEmptyDescription").textContent = "학습 파이프라인이 실행되면 완료·진행·실패 상태를 집계합니다.";
            integration.className = "dashboard-integration-note";
            integration.textContent = "연동 준비 완료 · 학습 파이프라인의 실행 이력을 기다리고 있습니다.";
        } else {
            integration.className = "dashboard-integration-note is-connected";
            integration.textContent = "AI 학습 파이프라인이 정상적으로 연결되어 있습니다.";
        }
    }

    function renderUserGrowth(rows) {
        const chart = query("#userGrowthChart");
        Common.dom.clear(chart);
        const data = Array.isArray(rows) ? rows : [];
        const maxCount = Math.max(1, ...data.map((item) => Number(item.userCount || 0)));
        data.forEach((item) => {
            const count = Number(item.userCount || 0);
            const column = Common.dom.element("div", { className: "bar-chart-column" });
            const barArea = Common.dom.element("span", { className: "bar-chart-track" });
            const bar = Common.dom.element("i", { className: "bar-chart-bar" });
            bar.style.setProperty("--bar-height", `${Math.max(count ? 12 : 3, (count / maxCount) * 100)}%`);
            barArea.appendChild(bar);
            column.append(
                Common.dom.element("strong", { text: formattedNumber(count) }),
                barArea,
                Common.dom.element("span", { text: item.monthLabel || item.monthKey || "-" })
            );
            chart.appendChild(column);
        });
    }

    function renderNoticeDistribution(rows) {
        const chart = query("#noticeTypeDistribution");
        Common.dom.clear(chart);
        const data = Array.isArray(rows) ? rows : [];
        if (!data.length) {
            chart.appendChild(Common.dom.element("div", {
                className: "dashboard-empty-state compact",
                text: "게시 콘텐츠가 없습니다."
            }));
            return;
        }
        const maxCount = Math.max(1, ...data.map((item) => Number(item.noticeCount || 0)));
        data.forEach((item) => {
            const count = Number(item.noticeCount || 0);
            const row = Common.dom.element("div", { className: "distribution-row" });
            const heading = Common.dom.element("div", { className: "distribution-heading" });
            heading.append(
                Common.dom.element("span", {
                    text: NOTICE_TYPE_LABELS[item.noticeType] || item.noticeType || "기타"
                }),
                Common.dom.element("strong", { text: formattedNumber(count) })
            );
            const track = Common.dom.element("span", { className: "distribution-track" });
            const bar = Common.dom.element("i", { className: "distribution-bar" });
            bar.style.setProperty("--distribution-width", `${(count / maxCount) * 100}%`);
            track.appendChild(bar);
            row.append(heading, track);
            chart.appendChild(row);
        });
    }

    function appendInsight(list, tone, symbol, title, description) {
        const item = Common.dom.element("li", { className: `insight-item is-${tone}` });
        item.append(
            Common.dom.element("span", { className: "insight-icon", text: symbol }),
            Common.dom.element("span", {}, [
                Common.dom.element("strong", { text: title }),
                Common.dom.element("small", { text: description })
            ])
        );
        list.appendChild(item);
    }

    function renderInsights(data) {
        const list = query("#homeInsightList");
        Common.dom.clear(list);
        const totalUsers = number(data, "userCount");
        const activeUsers = number(data, "activeUserCount");
        const activeRate = totalUsers ? activeUsers / totalUsers : 0;
        const growth = Array.isArray(data.userGrowth) ? data.userGrowth : [];
        const currentGrowth = Number(growth.at(-1)?.userCount || 0);
        const previousGrowth = Number(growth.at(-2)?.userCount || 0);
        const activity = Array.isArray(data.sessionActivity) ? data.sessionActivity : [];
        const latestActivity = Number(activity.at(-1)?.activeUserCount || 0);
        const ai = data.aiTraining || {};

        appendInsight(
            list,
            activeRate >= 0.7 ? "positive" : "neutral",
            "◎",
            `사용자 활성률 ${formattedPercent(activeRate)}`,
            `${formattedNumber(activeUsers)}명의 사용자가 현재 활성 상태입니다.`
        );
        appendInsight(
            list,
            currentGrowth >= previousGrowth ? "positive" : "neutral",
            currentGrowth >= previousGrowth ? "↗" : "→",
            `이번 달 신규 사용자 ${formattedNumber(currentGrowth)}명`,
            `직전 달 대비 ${formattedNumber(Math.abs(currentGrowth - previousGrowth))}명 ${
                currentGrowth >= previousGrowth ? "증가 또는 유지" : "감소"
            }했습니다.`
        );
        appendInsight(
            list,
            latestActivity > 0 ? "positive" : "neutral",
            "⌁",
            `오늘 세션 활동 ${formattedNumber(latestActivity)}명`,
            "최근 7일 서버 세션의 실제 활동 기록을 기준으로 집계했습니다."
        );
        appendInsight(
            list,
            number(ai, "failedCount") > 0 ? "warning" : "ai",
            "AI",
            ai.tableAvailable === false
                ? "AI 학습 데이터 연동 필요"
                : `AI 학습 완료 ${formattedNumber(number(ai, "completedCount"))}회`,
            ai.tableAvailable === false
                ? "증분 DDL 적용 후 학습 파이프라인 실행 이력을 연결할 수 있습니다."
                : (number(ai, "totalCount")
                    ? `평균 정확도 ${formattedPercent(ai.averageAccuracy)}를 기록하고 있습니다.`
                    : "테이블 연동은 완료되었으며 첫 학습 실행을 기다리고 있습니다.")
        );
    }

    function renderDashboard(data) {
        const userCount = number(data, "userCount");
        const activeUserCount = number(data, "activeUserCount");
        const activeRate = userCount ? activeUserCount / userCount : 0;
        const aiTraining = data.aiTraining || {};

        query("#homeUserCount").textContent = formattedNumber(userCount);
        query("#homeUserDetail").textContent = `최근 6개월 신규 ${formattedNumber(
            (data.userGrowth || []).reduce((sum, item) => sum + Number(item.userCount || 0), 0)
        )}명`;
        query("#homeActiveRate").textContent = formattedPercent(activeRate);
        query("#homeActiveUserDetail").textContent = `${formattedNumber(activeUserCount)}명 활성 / 전체 ${formattedNumber(userCount)}명`;
        query("#homeAiCompletedCount").textContent = formattedNumber(number(aiTraining, "completedCount"));
        query("#homeAiDetail").textContent = number(aiTraining, "totalCount")
            ? `진행 ${formattedNumber(number(aiTraining, "activeCount"))} · 실패 ${formattedNumber(number(aiTraining, "failedCount"))}`
            : "최근 30일 학습 이력 없음";
        query("#homeNoticeCount").textContent = formattedNumber(number(data, "noticeCount"));
        query("#homeUpdatedAt").textContent = `${new Intl.DateTimeFormat("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }).format(new Date())} 기준`;

        renderAiTrend(aiTraining);
        renderAiOperations(aiTraining);
        renderUserGrowth(data.userGrowth);
        renderNoticeDistribution(data.noticeTypes);
        renderInsights(data);
        renderNotices(data.notices);
    }

    async function loadDashboard() {
        const status = query("#homeStatus");
        Common.ui.setInlineStatus(status, "데이터 인사이트를 불러오고 있습니다.");
        try {
            const payload = await Common.api.request("/home/dashboard", {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            renderDashboard(Common.data.get(payload) || {});
            Common.ui.setInlineStatus(status, "");
        } catch (error) {
            if (error?.name === "AbortError") return;
            renderNotices([]);
            Common.ui.setInlineStatus(status, error.message || "대시보드를 불러오지 못했습니다.", "error");
        }
    }

    window.Pages.home = {
        async init(context) {
            root = context.root;
            controller = new AbortController();
            const user = App.getUser();
            query("#homeGreeting").textContent = `${user?.userName || user?.loginId || "사용자"}님, 오늘의 AI 학습과 서비스 통계 현황입니다.`;
            query("#homeRefreshButton")?.addEventListener("click", loadDashboard, {
                signal: controller.signal
            });
            await loadDashboard();
        },

        destroy() {
            controller?.abort();
            controller = null;
            root = null;
        }
    };
})();
