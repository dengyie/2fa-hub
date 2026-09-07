// 认证路由：注册（首位用户自动管理员）/ 登录 / 登出 / 当前用户 / 改密
import { db, getSetting, audit } from '../db.js';
import { hashPassword, verifyPassword, signToken, verifyToken, sessionExpiry } from '../crypto.js';
import { HttpError } from '../http.js';
import { allow, reset } from '../limiter.js';
import { config } from '../config.js';

export const COOKIE_NAME = 'otk_session';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cookieHeader(token, maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly',
    `SameSite=${config.cookieSameSite}`,
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, is_admin: !!u.is_admin, is_active: !!u.is_active };
}

function issueSession(ctx, user) {
  const payload = { uid: user.id, ver: user.token_version, exp: sessionExpiry() };
  ctx.setCookie(cookieHeader(signToken(payload), config.tokenTtlDays * 86400));
}

/** 首次启动时系统里是否存在任何用户 */
export function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function effectiveRegisterMode() {
  return getSetting('register_mode', config.registerMode);
}

export function registerAuthRoutes(router) {
  router.post('/api/auth/register', async (ctx) => {
    const email = String(ctx.body?.email || '').trim();
    const { name, password } = ctx.body || {};
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'invalid email');
    if (!password || String(password).length < 8) throw new HttpError(400, 'password must be at least 8 characters');
    const mode = effectiveRegisterMode();
    // 首个用户豁免注册模式限制（否则 REGISTER_MODE=closed/invite 的全新实例无法初始化）
    if (userCount() > 0) {
      if (mode === 'closed') throw new HttpError(403, 'registration is disabled');
      if (mode === 'invite') {
        // 邀请码只经环境变量配置（INVITE_CODE）；未配置时视为关闭注册，避免"锁死"假象
        const expected = getSetting('invite_code', config.inviteCode);
        if (!expected || ctx.body?.invite_code !== expected) throw new HttpError(403, 'invalid invite code');
      }
    }
    if (!allow(`register:${ctx.ip}`, 5, 3600_000)) throw new HttpError(429, 'too many attempts');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'email already registered');
    // 首位用户授予管理员必须在 INSERT 内原子判定，否则并发注册可产生多个管理员
    let info;
    try {
      info = db.prepare(
        `INSERT INTO users (email, name, password_hash, is_admin)
         VALUES (?, ?, ?, (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM users))`,
      ).run(email, String(name || email.split('@')[0]).slice(0, 50), hashPassword(password));
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'email already registered');
      throw err;
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    audit(user.id, 'register', `email=${user.email} admin=${user.is_admin}`, ctx.ip, ctx.ua);
    issueSession(ctx, user);
    ctx.json(201, { user: publicUser(user) });
  });

  router.post('/api/auth/login', async (ctx) => {
    const { email, password } = ctx.body || {};
    const key = `login:${ctx.ip}:${String(email || '').toLowerCase()}`;
    if (!allow(key, 10, 5 * 60_000)) throw new HttpError(429, 'too many attempts, try later');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || ''));
    // 统一失败响应，防账号枚举
    const fail = () => {
      audit(user?.id ?? null, 'login_fail', String(email || ''), ctx.ip, ctx.ua);
      throw new HttpError(401, 'invalid email or password');
    };
    if (!user || !verifyPassword(String(password || ''), user.password_hash)) fail();
    if (!user.is_active) throw new HttpError(403, 'account disabled, contact admin');
    reset(key);
    issueSession(ctx, user);
    audit(user.id, 'login', '', ctx.ip, ctx.ua);
    ctx.json(200, { user: publicUser(user) });
  });

  router.post('/api/auth/logout', async (ctx) => {
    ctx.setCookie(cookieHeader('', 0));
    ctx.json(200, { ok: true });
  });

  router.get('/api/me', authRequired, async (ctx) => {
    ctx.json(200, { user: publicUser(ctx.user) });
  });

  router.post('/api/auth/change-password', authRequired, async (ctx) => {
    const { current, next } = ctx.body || {};
    if (!verifyPassword(String(current || ''), ctx.user.password_hash)) throw new HttpError(401, 'wrong current password');
    if (!next || String(next).length < 8) throw new HttpError(400, 'password must be at least 8 characters');
    // 改密提升 token_version：旧会话全部失效
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = datetime(\'now\') WHERE id = ?')
      .run(hashPassword(next), ctx.user.id);
    audit(ctx.user.id, 'change_password', '', ctx.ip, ctx.ua);
    issueSession(ctx, { ...ctx.user, token_version: ctx.user.token_version + 1 });
    ctx.json(200, { ok: true });
  });

  router.get('/api/bootstrap', async (ctx) => {
    // 前端启动探测：注册是否开放 / 系统是否已初始化
    ctx.json(200, {
      initialized: userCount() > 0,
      register_mode: effectiveRegisterMode(),
    });
  });
}

/** 认证中间件：校验 cookie / Bearer，注入 ctx.user */
export function authRequired(ctx) {
  const cookieToken = (ctx.req.headers.cookie || '')
    .split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE_NAME + '='));
  const token = cookieToken ? cookieToken.slice(COOKIE_NAME.length + 1)
    : String(ctx.req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = verifyToken(token);
  if (!payload) throw new HttpError(401, 'unauthenticated');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
  if (!user || !user.is_active) throw new HttpError(403, 'account disabled or missing');
  if (user.token_version !== payload.ver) throw new HttpError(401, 'session expired, please login again');
  ctx.user = user;
}

/** 管理员中间件 */
export function adminRequired(ctx) {
  authRequired(ctx);
  if (!ctx.user.is_admin) throw new HttpError(403, 'admin only');
}
