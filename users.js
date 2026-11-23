// users.js — 账号、密码、项目权限配置
// 纯前端实现，仅作为"访客分流界面"，不是安全边界
// 修改后保存即可，无需其他操作

// 全部项目名（admin 的 projects 填 "*" 时会显示这里的全部项目）
window.ALL_PROJECTS = ["kim"];

window.USERS = {

  // 管理员："*" 表示自动包含全部项目，新增项目只需加到 ALL_PROJECTS
  "admin": {
    pass: "123456",
    projects: "*"
  },
  "zhang": { pass: "zhang2026", projects: ["zhang"] },
  "kim":    { pass: "kim2026",    projects: ["kim"] }
  // 普通成员：数组里只写自己的项目名，登录后只能看到自己的卡片
  // 注意：projects/<名字>/ 目录必须真实存在，否则卡片会显示为灰色不可点
  // "zhang": { pass: "zhang2026", projects: ["zhang"] },
  // "li":    { pass: "li2026",    projects: ["li"] }
};
