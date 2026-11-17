// users.js — 账号、密码、项目权限配置
// 纯前端实现，仅作为"访客分流界面"，不是安全边界
// 修改后保存即可，无需其他操作

window.USERS = {

  // 示例账号 1：管理员，能看所有项目
  "admin": {
    pass: "123456",
    projects: ["kim"]   // ← 以后加了新项目就在这里追加 "proj-b", "proj-c"
  }

  // 继续添加账号：
  // "viewer": { pass: "guest", projects: ["kim", "proj-b"] }
};
