// 极简路由框架：方法+路径匹配、JSON body 解析、统一错误处理、CORS、静态文件 + SPA 回退。
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

export class Router {
  #routes = [];

  add(method, pattern, ...handlers) {
    this.#routes.push({
      method, segs: pattern.split('/').filter(Boolean), handlers,
    });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  put(p, ...h) { this.add('PUT', p, ...h); }
  patch(p, ...h) { this.add('PATCH', p, ...h); }
  delete(p, ...h) { this.add('DELETE', p, ...h); }

  match(method, parts) {
    for (const r of this.#routes) {
      if (r.method !== method) continue;
      const params = {};
      let ok = r.segs.length === parts.length;
      for (let i = 0; ok && i < r.segs.length; i++) {
        const seg = r.segs[i];
        if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]);
        else if (seg !== parts[i]) ok = false;
      }
      if (ok) return { handlers: r.handlers, params };
    }
    return null;
  }

  async dispatch(ctx) {
    const parts = ctx.path.split('/').filter(Boolean);
    const m = this.match(ctx.method, parts);
    if (!m) throw new HttpError(404, 'not found');
    ctx.params = m.params;
    for (const h of m.handlers) {
      await h(ctx);
      if (ctx.res.writableEnded) return;
    }
    throw new HttpError(405, 'method not handled');
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function securityHeaders() {
  // 跨域前端需要被授权使用摄像头（扫码）
  const cameraAllow = ['(self)', ...config.allowedOrigins].join(' ');
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': `camera=${cameraAllow}, geolocation=()`,
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; " +
      "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  };
}

/** CORS：仅白名单 origin；携带 cookie 需 echo 具体 origin + Allow-Credentials */
function applyCors(req, headers) {
  const origin = req.headers.origin;
  if (!origin || !config.allowedOrigins.includes(origin)) return false;
  headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Credentials'] = 'true';
  headers['Vary'] = 'Origin';
  return true;
}

/** 创建 HTTP 服务：API 交给 router；配置了 STATIC_DIR 时附带静态托管（SPA 回退），否则纯 API */
export function createAppServer(router, { staticDir, bodyLimit }) {
  const hasStatic = staticDir && existsSync(join(staticDir, 'index.html'));
  if (staticDir && !hasStatic) {
    console.log('[2fa-hub] 未找到前端构建产物（' + staticDir + '），以纯 API 模式运行');
  }
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const headers = { ...securityHeaders() };
    applyCors(req, headers);
    // 预检请求短路
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Requested-With, Authorization';
      headers['Access-Control-Max-Age'] = '86400';
      res.writeHead(204, headers);
      res.end();
      return;
    }
    const ctx = {
      req, res,
      method: req.method,
      path: url.pathname,
      query: url.searchParams,
      params: {},
      ip: req.socket.remoteAddress || '',
      ua: req.headers['user-agent'] || '',
      body: null,
      json(status, data) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        res.writeHead(status, headers);
        res.end(JSON.stringify(data));
      },
      setCookie(value) {
        headers['Set-Cookie'] = headers['Set-Cookie'] ? headers['Set-Cookie'] + ', ' + value : value;
      },
    };
    try {
      if (ctx.path.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'DELETE') {
          const raw = await readBody(req, bodyLimit);
          if (raw.length) {
            try { ctx.body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'invalid json body'); }
          }
        } else if (req.method === 'DELETE') {
          const raw = await readBody(req, bodyLimit).catch(() => Buffer.alloc(0));
          if (raw.length) { try { ctx.body = JSON.parse(raw.toString('utf8')); } catch { /* ignore */ } }
        }
        await router.dispatch(ctx);
        if (!res.writableEnded) throw new HttpError(500, 'handler produced no response');
      } else if (hasStatic) {
        await serveStatic(ctx, staticDir, headers);
      } else {
        throw new HttpError(404, 'API server only — frontend not bundled (build web/ and set STATIC_DIR)');
      }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error('[2fa-hub]', req.method, ctx.path, err);
      if (!res.writableEnded) ctx.json(status, { error: err.message || 'internal error' });
    }
  });
}

async function serveStatic(ctx, staticDir, headers) {
  let filePath = normalize(ctx.path).replace(/^(\.\.[/\\])+/, '');
  if (filePath === '/' || filePath === '\\') filePath = '/index.html';
  const abs = join(staticDir, filePath);
  if (!abs.startsWith(staticDir)) throw new HttpError(403, 'forbidden');
  try {
    const st = await stat(abs);
    if (!st.isFile()) throw new Error('not a file');
    const data = await readFile(abs);
    headers['Content-Type'] = MIME[extname(abs)] || 'application/octet-stream';
    headers['Cache-Control'] = filePath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    ctx.res.writeHead(200, headers);
    ctx.res.end(data);
  } catch {
    // SPA 回退：非资源路径一律回 index.html
    if (extname(abs)) throw new HttpError(404, 'not found');
    const data = await readFile(join(staticDir, 'index.html'));
    headers['Content-Type'] = 'text/html; charset=utf-8';
    headers['Cache-Control'] = 'no-cache';
    ctx.res.writeHead(200, headers);
    ctx.res.end(data);
  }
}
