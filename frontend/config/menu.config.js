window.MENU_CONFIG = [
    {
        type: "page",
        page: "home",
        label: "홈",
        title: "홈",
        icon: "⌂"
    },
    {
        type: "page",
        page: "account",
        label: "내 계정",
        title: "내 계정",
        icon: "○"
    },
    {
        type: "group",
        key: "admin",
        label: "관리",
        roles: ["ADMIN"],
        children: [
            {
                type: "page",
                page: "admin-users",
                label: "임직원 관리",
                title: "임직원 관리",
                icon: "◇",
                roles: ["ADMIN"]
            },
            {
                type: "page",
                page: "admin-projects",
                label: "프로젝트 관리",
                title: "프로젝트 관리",
                icon: "▦",
                roles: ["ADMIN"]
            },
            {
                type: "page",
                page: "project-assignments",
                label: "프로젝트 투입",
                title: "프로젝트 투입",
                icon: "♙",
                roles: ["ADMIN"]
            },
            {
                type: "page",
                page: "admin-notices",
                label: "공지사항 관리",
                title: "공지사항 관리",
                icon: "□",
                roles: ["ADMIN"]
            },
            {
                type: "page",
                page: "admin-site-settings",
                label: "디자인 설정",
                title: "포털 디자인 설정",
                icon: "✦",
                roles: ["ADMIN"]
            }
        ]
    }
];

window.PAGE_FILE_CONFIG = {
    htmlPages: ["login", "home", "account", "admin-users", "admin-projects", "project-assignments", "admin-notices", "admin-site-settings"],
    scriptPages: ["login", "home", "account", "admin-users", "admin-projects", "project-assignments", "admin-notices", "admin-site-settings"]
};
