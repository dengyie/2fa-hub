import { config } from './config.js';
import { Router, createAppServer } from './http.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerEntryRoutes } from './routes/entries.js';
import { registerAdminRoutes } from './routes/admin.js';

const router = new Router();
router.get('/api/health', async (ctx) => ctx.json(200, { ok: true }));
registerAuthRoutes(router);
registerEntryRoutes(router);
registerAdminRoutes(router);

const server = createAppServer(router, { staticDir: config.staticDir, bodyLimit: config.bodyLimit });
server.listen(config.port, () => {
  console.log(`[2fa-hub] listening on http://127.0.0.1:${config.port}`);
});
