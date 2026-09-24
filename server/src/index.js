import { config } from './config.js';
import { Router, createAppServer } from './http.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerEntryRoutes } from './routes/entries.js';
import { registerAdminRoutes } from './routes/admin.js';
import { scheduleAuditCleanup } from './db.js';

scheduleAuditCleanup();

const router = new Router();
router.get('/api/health', async (ctx) => ctx.json(200, { ok: true }));
registerAuthRoutes(router);
registerEntryRoutes(router);
registerAdminRoutes(router);

const server = createAppServer(router, { staticDir: config.staticDir, bodyLimit: config.bodyLimit });
// 默认仅绑回环（HOST 未设时）；确需对外监听必须显式 HOST=0.0.0.0
const host = process.env.HOST || '127.0.0.1';
server.listen(config.port, host, () => {
  console.log(`[2fa-hub] listening on http://${host}:${config.port}`);
});

// 优雅停机：docker stop 先发 SIGTERM，关掉监听等在途请求收尾（10s 强杀兜底）
process.on('SIGTERM', () => {
  console.log('[2fa-hub] SIGTERM received, shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 9000).unref();
});
