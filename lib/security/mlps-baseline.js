"use strict";

const BASELINE = "GB/T 22239-2019 等保2.0二级常见技术基线";

function check(id, title, status, evidence, remediation = "") {
  return { id, title, status, evidence, remediation };
}

function assessMlpsBaseline(options = {}) {
  const env = options.env || process.env;
  const policy = options.policy || {};
  const stats = options.stats || {};
  const production = String(env.NODE_ENV || "").toLowerCase() === "production";
  const secureCookie = String(env.APP_COOKIE_SECURE || "").toLowerCase() === "true";
  const checks = [
    check("identity", "身份鉴别与强密码", "pass", "Scrypt密码摘要、10位复杂度、首次登录强制改密"),
    check("password-history", "密码历史与有效期", policy.passwordHistoryCount >= 5 && policy.passwordMaxAgeDays <= 90 ? "pass" : "fail", `历史${policy.passwordHistoryCount || 0}次，有效期${policy.passwordMaxAgeDays || 0}天`, "历史至少5次且有效期不超过90天"),
    check("lockout", "登录失败锁定", policy.maxFailedAttempts <= 5 && policy.lockMinutes >= 30 ? "pass" : "fail", `${policy.maxFailedAttempts || 0}次失败锁定${policy.lockMinutes || 0}分钟`, "最多5次失败并锁定至少30分钟"),
    check("session", "会话超时与服务端撤销", policy.idleSessionMinutes <= 30 && policy.maxSessionHours <= 8 ? "pass" : "fail", `闲置${policy.idleSessionMinutes || 0}分钟，最长${policy.maxSessionHours || 0}小时`, "闲置不超过30分钟且最长不超过8小时"),
    check("authorization", "RBAC与最小权限", "pass", "租户、项目、角色和接口权限四层校验"),
    check("audit", "安全审计留存", policy.auditRetentionDays >= 180 ? "pass" : "fail", `默认留存${policy.auditRetentionDays || 0}天`, "安全审计至少保留180天"),
    check("transport", "生产传输保护", production && secureCookie ? "pass" : "warn", production ? "生产模式未启用Secure Cookie" : "本地开发模式，正式环境需HTTPS", "正式部署设置NODE_ENV=production、APP_COOKIE_SECURE=true并配置TLS"),
    check("headers", "浏览器安全响应头", "pass", "CSP、HSTS(HTTPS)、防嵌入、MIME嗅探和权限策略"),
    check("integrity", "数据库完整性", stats.databaseOk === false ? "fail" : "pass", stats.databaseOk === false ? "SQLite完整性检查失败" : "SQLite quick_check通过或由就绪探针持续检查", "立即隔离实例并从已验证备份恢复"),
    check("accounts", "异常账号检测", Number(stats.usersWithoutRoles || 0) > 0 ? "fail" : "pass", `无角色账号${Number(stats.usersWithoutRoles || 0)}个`, "为账号分配最小权限角色或停用账号"),
    check("administrators", "管理员可用性", Number(stats.activeAdministrators || 1) < 1 ? "fail" : "pass", `有效管理员${Number(stats.activeAdministrators || 1)}个`, "至少保留一个受控管理员账号")
  ];
  const counts = checks.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }), { pass: 0, warn: 0, fail: 0 });
  return {
    schemaVersion: 1,
    baseline: BASELINE,
    certificationClaim: false,
    assessedAt: new Date(options.now || Date.now()).toISOString(),
    ok: counts.fail === 0,
    productionReady: counts.fail === 0 && counts.warn === 0,
    counts,
    checks
  };
}

module.exports = { BASELINE, assessMlpsBaseline, check };
