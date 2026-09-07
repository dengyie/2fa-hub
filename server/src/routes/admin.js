// 管理员路由：用户全量管控（禁用/启用/删号/重置密码/提权）+ 系统设置 + 审计日志
import { db, audit, setSetting } from '../db.js';
import { hashPassword } from '../crypto.js';
import { HttpError } from '../http.js';
import { adminRequired } from './auth.js';

function adminUserView(u) {
  return {
    id: u.id, email: u.email, name: u.name, is_admin: !!u.is_admin, is_active: !!u.is_active,
    created_at: u.created_at,
    entries: db.prepare('SELECT COUNT(*) AS n FROM entries WHERE user_id = ?').get(u.id).n,
  };
}

export function registerAdminRoutes(router) {
  router.get('/api/admin/users', adminRequired, async (ctx) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY id').all();
    ctx.json(200, { users: rows.map(adminUserView) });
  });

  router.patch('/api/admin/users/:id', adminRequired, async (ctx) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(ctx.params.id));
    if (!target) throw new HttpError(404, 'user not found');
    const b = ctx.body || {};
    if (target.id === ctx.user.id && (b.is_active === false || b.is_admin === false)) {
      throw new HttpError(400, 'cannot disable or demote yourself');
    }
    if (b.is_active !== undefined) {
      db.prepare('UPDATE users SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(b.is_active ? 1 : 0, target.id);
      audit(ctx.user.id, 'admin_set_active', `user=${target.id} active=${!!b.is_active}`, ctx.ip, ctx.ua);
    }
    if (b.is_admin !== undefined) {
      db.prepare('UPDATE users SET is_admin = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(b.is_admin ? 1 : 0, target.id);
      audit(ctx.user.id, 'admin_set_admin', `user=${target.id} admin=${!!b.is_admin}`, ctx.ip, ctx.ua);
    }
    if (b.name !== undefined) {
      db.prepare('UPDATE users SET name = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(String(b.name).slice(0, 50), target.id);
    }
    if (b.password !== undefined) {
      if (String(b.password).length < 8) throw new HttpError(400, 'password must be at least 8 characters');
      // 重置密码同时作废旧会话
      db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = datetime(\'now\') WHERE id = ?')
        .run(hashPassword(String(b.password)), target.id);
      audit(ctx.user.id, 'admin_reset_password', `user=${target.id}`, ctx.ip, ctx.ua);
    }
    ctx.json(200, { user: adminUserView(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)) });
  });

  router.delete('/api/admin/users/:id', adminRequired, async (ctx) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(ctx.params.id));
    if (!target) throw new HttpError(404, 'user not found');
    if (target.id === ctx.user.id) throw new HttpError(400, 'cannot delete yourself');
    if (target.is_admin && db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n <= 1) {
      throw new HttpError(400, 'cannot delete the last admin');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id); // entries 级联删除
    audit(ctx.user.id, 'admin_delete_user', `user=${target.id} email=${target.email}`, ctx.ip, ctx.ua);
    ctx.json(200, { ok: true });
  });

  router.put('/api/admin/settings', adminRequired, async (ctx) => {
    const b = ctx.body || {};
    if (b.register_mode !== undefined) {
      if (!['open', 'closed', 'invite'].includes(b.register_mode)) throw new HttpError(400, 'invalid register_mode');
      setSetting('register_mode', b.register_mode);
      audit(ctx.user.id, 'admin_setting', `register_mode=${b.register_mode}`, ctx.ip, ctx.ua);
    }
    ctx.json(200, { register_mode: db.prepare('SELECT value FROM settings WHERE key = ?').get('register_mode')?.value ?? 'open' });
  });

  router.get('/api/admin/audit', adminRequired, async (ctx) => {
    const limit = Math.min(500, Math.max(1, Number(ctx.query.get('limit')) || 100));
    const rows = db.prepare(
      `SELECT a.*, u.email AS user_email FROM audit a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.id DESC LIMIT ?`,
    ).all(limit);
    ctx.json(200, { audit: rows });
  });
}
