# 2fa-hub

> **2fa-hub** —— 自托管的双模式 2FA 验证码保险库 —— 登录云端同步，游客纯本地，管理员全局管控。

## 特性

**两种使用模式，一套体验：**

- ☁️ **云端模式（登录用户）**：注册登录后，2FA 条目以 AES-256-GCM 加密存入服务器 SQLite，多端实时同步。
- 🔒 **本地模式（游客）**：无需账号，条目只保存在本机浏览器（localStorage），**绝不经过网络**；可选口令整库加密（PBKDF2 200k + AES-GCM）。
- 🛡️ **管理员面板**：首位注册用户自动成为管理员，可禁用/启用/删除任意账户、重置密码（即时踢下线）、授予管理员、切换注册模式（开放/邀请码/关闭）、查看审计日志。

**核心能力：**

- TOTP / HOTP，SHA1/SHA256/SHA512，6–10 位，自定义周期与计数器（实现通过 RFC 4226 / 6238 官方测试向量验证）
- 实时出码 + 倒计时 + 一键复制 + HOTP 计数器多端同步
- 摄像头扫码 / 二维码图片识别 / 粘贴 `otpauth://` 链接 / 手工录入
- 导入：**2FAS、Aegis（明文）、Google Authenticator otpauth 链接、2fa-hub JSON**
- 导出：JSON（含 secret）与 otpauth 链接列表，随时迁出，绝不锁定用户

**工程与安全：**

- 服务端 **零 npm 运行时依赖**（Node 原生 `node:sqlite` + `node:crypto`），攻击面极小
- secret 落盘 AES-256-GCM 加密，密钥 HKDF 分离（加密/会话签名两把子密钥）
- scrypt(N=32768) 口令哈希、HMAC 签名会话令牌（HttpOnly + SameSite=Strict + Secure cookie）
- 登录/注册限流、防账号枚举、审计日志（登录/失败/出码/管理员操作）、CSP / X-Frame-Options / nosniff
- 单容器 ~60MB 内存，1GB VPS 友好；架构参考 2FAuth/Aegis/Ente Auth 的经验教训

## 快速开始

### Docker（推荐）

```bash
git clone <repo> && cd 2fa-hub
docker compose up -d
# 打开 http://127.0.0.1:8000 —— 首个注册用户自动成为管理员
```

生产环境用 Caddy/nginx 反代加 HTTPS（条目 secret 经 TLS 传输）：

```
# Caddyfile
2fa.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8000
}
```

### 本地开发

```bash
# 服务端（Node >= 22.5，无需 npm install）
cd server && npm start          # http://127.0.0.1:8000

# 前端（热更新，代理 /api 到 8000；API_PROXY 可改后端地址）
cd web && npm install && npm run dev

# 测试（19 个用例，含 RFC 官方测试向量）
cd server && npm test
```

## 前后端分离部署

服务端默认**纯 API 模式**（未找到 `web/dist` 时不托管静态文件）；同域单容器部署仍兼容（Docker 内已内置 dist）。

前端单独部署到任意静态托管（Nginx / Cloudflare Pages / Vercel / GitHub Pages）：

```bash
cd web
VITE_API_BASE=https://api.example.com npm run build   # 构建时指定后端 origin
# 将 dist/ 发布到静态托管；SPA 路由需回退 index.html
```

后端需放开 CORS 与跨站 cookie：

```env
ALLOWED_ORIGINS=https://hub.example.com   # 前端 origin 白名单（逗号分隔）
COOKIE_SAMESITE=None                      # 跨站 cookie（需同时 COOKIE_SECURE=1）
COOKIE_SECURE=1
```

- CORS 仅精确白名单命中才回 `Access-Control-Allow-Origin`（带 credentials）
- 摄像头扫码权限自动随白名单下放（`Permissions-Policy: camera=(self) <origins>`）

## ⚠️ 备份

`DATA_DIR` 下两样东西缺一不可：

1. `2fa-hub.db` —— 用户与加密条目
2. `.master_key` —— 加密根密钥，**丢失 = 所有云端 secret 永久无法解密**

本地模式数据在浏览器 localStorage，清除浏览器数据前请先导出。

## 架构

前后端完全分离：服务端是纯 JSON API（可选附带静态托管），前端是独立 Vue 3 SPA，可独立开发、构建、部署。

```
├── shared/          # base32 / TOTP-HOTP / otpauth URI（前后端共用，RFC 向量测试）
├── server/          # Node 原生 ESM，零运行时依赖 —— 纯 JSON API（CORS 白名单）
│   ├── src/         # config / crypto(AES-GCM+scrypt+HMAC) / db(SQLite) / http(路由+CORS) / limiter
│   │   └── routes/  # auth / entries / admin
│   └── test/        # node:test 集成测试 + RFC 向量
├── web/             # Vue 3 + Vite + Tailwind CSS v4 SPA（独立部署）
│   └── src/
│       ├── views/       # 登录 / 云端保险库 / 本地保险库 / 管理面板
│       ├── components/  # OtpCard / EntryModal / ScannerModal(jsQR) / ImportModal
│       ├── components/ui/  # awesome-ui 标准组件（UiIcon / ThemeToggle / StatusIndicator）
│       └── lib/         # localvault(WebCrypto) / formats(导入导出) / useVault
└── Dockerfile       # 多阶段构建，单容器（API + 内置 dist）
```

UI 基于 [awesome-ui](https://github.com/dengyie/awesome-ui) 标准组件装配：全局图标统一走 `UiIcon`（Tabler 规范几何），主题切换 `ThemeToggle`（亮/暗/跟随系统），管理面板健康徽章 `StatusIndicator`。

## 设计决策

| 决策 | 理由 |
|---|---|
| 出码在前端完成（游客/登录同一套逻辑） | 服务端零出码负载；本地模式天然离线；代码路径单一便于审计 |
| 服务端 secret 加密落盘但 API 返回明文 | 出码在前端的必然要求，靠 TLS + cookie 安全传输；端到端加密在路线图 |
| Node 原生依赖零化 | 2FA 工具自身必须是最小攻击面；供应链风险归零 |
| 加密不可关闭 | 2FAuth 的教训——可选加密 + 静默降级是安全坑 |
| 前后端分离 + CORS 白名单 | 前端可上 CDN/静态托管，后端可独立加固、独立伸缩；API-only 模式攻击面更小 |

## 路线图

- [ ] WebAuthn/passkey 登录（替代密码）
- [ ] 端到端加密同步（服务端只存密文，参考 Ente 架构）
- [ ] 分组/标签、加密备份导入（Aegis encrypted）
- [ ] PWA 离线出码
- [ ] Steam Guard

## 许可证

[AGPL-3.0](./LICENSE) —— 防止云厂商闭源白嫖；如需商业授权请联系作者。

---
*v0.1.0 · 2026-09 · AGPL-3.0 · dengyie/2fa-hub*
