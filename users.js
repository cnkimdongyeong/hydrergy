// users.js — 账号、密码、项目权限配置
// 密码以 SHA-256 哈希保存（sha256("hydrergy::" + 明文)），源码里看不到明文
// 新增账号请用 admin.html 管理面板，它会自动算哈希；
// 手动把 pass 写成明文会导致该账号无法登录
// 注意：纯前端分流，不是安全边界

// 全部项目名（管理员 projects 为 "*" 时会显示这里的全部项目）
window.ALL_PROJECTS = ["kim", "zhang"];

window.USERS = {

  // 管理员："*" 表示自动包含全部项目
  "hydrergydigital": {
    pass: "eb4613750aa770afb59c6e98da65eafa623aa7035887297cde5dd417012b94ce",
    projects: "*"
  },

  // 普通成员：数组里只写自己的项目名
  "zhang": { pass: "4fdf00d87311e400eb58ee9071d04f6930911416f64fc87b3908ee4876306eb4", projects: ["zhang"] },
  "kim":   { pass: "a77731fbc497487a0e45fec356f95658b48183732de77f163d57bc571799acc8", projects: ["kim"] }
};
