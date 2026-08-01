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
                label: "사용자 관리",
                title: "사용자 관리",
                icon: "◇",
                roles: ["ADMIN"]
            },
            {
                type: "page",
                page: "admin-notices",
                label: "공지사항 관리",
                title: "공지사항 관리",
                icon: "□",
                roles: ["ADMIN"]
            }
        ]
    }
];

window.PAGE_FILE_CONFIG = {
    htmlPages: ["login", "home", "account", "admin-users", "admin-notices"],
    scriptPages: ["login", "home", "account", "admin-users", "admin-notices"]
};
