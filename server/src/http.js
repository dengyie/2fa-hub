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
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
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
      "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; media-src 'self' blob:; " +
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

/** IPv6-mapped IPv4（::ffff:a.b.c.d）归一为 a.b.c.d：双栈监听时 socket 地址是 mapped 形式，
 *  不归一则限流/审计 key 会随监听 family 漂移（127.0.0.1 与 ::ffff:127.0.0.1 成两个桶） */
export function normalizeIp(ip) {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/** 是否「本机/内网」地址，用于 X-Forwarded-For 链中跳过可信跳板。
 *  覆盖 RFC 1918 全部三段（10/8、172.16/12、192.168/16）、CGNAT 100.64/10、
 *  链路本地 169.254/16 与 ::1、IPv6 ULA fc00::/7、IPv4-mapped 回环——
 *  漏掉任何一段都会让该段地址被当成客户端 IP，导致限流 key 碎片化、审计误归属。 */
export function isPrivateIp(ip) {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  const p = ip.split('.');
  // 172.16.0.0/12 与 100.64.0.0/10 只有点分 IPv4 才匹配
  if (p.length === 4) {
    const o1 = Number(p[0]), o2 = Number(p[1]);
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true;
  }
  // fc00::/7（含 fd00::/8 本地唯一地址）与 fe80::/10 链路本地
  const hex2 = ip.slice(0, 2).toLowerCase();
  if (hex2[0] === 'f' && 'cd'.includes(hex2[1])) return true; // fc.. / fd..
  if (hex2 === 'fe' && '89ab'.includes(ip[2]?.toLowerCase() ?? '')) return true; // fe80..febf
  return false;
}

/** 客户端真实 IP：TRUST_PROXY=1（可信反代之后）时取 X-Forwarded-For 最右一个非回环/非内网跳，
 *  否则一律用 socket 地址——不信任请求头，防止伪造 XFF 绕过限流与审计。 */
export function clientIp(req) {
  if (!config.trustProxy) return normalizeIp(req.socket.remoteAddress || '');
  const chain = String(req.headers['x-forwarded-for'] || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) {
    const ip = normalizeIp(chain[i]);
    if (!isPrivateIp(ip)) return ip;
  }
  return normalizeIp(req.socket.remoteAddress || '');
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
      ip: clientIp(req),
      ua: req.headers['user-agent'] || '',
      body: null,
      json(status, data) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        headers['Cache-Control'] = 'no-store'; // API 响应（尤其 /api/entries/full）绝不允许任何缓存层落盘
        res.writeHead(status, headers);
        if (req.method === 'HEAD') {
          res.end();
        } else {
          res.end(JSON.stringify(data));
        }
      },
      setCookie(value) {
        headers['Set-Cookie'] = headers['Set-Cookie'] ? headers['Set-Cookie'] + ', ' + value : value;
      },
    };
    try {
      if (ctx.path.startsWith('/api/')) {
        // CSRF 防线：浏览器表单/no-cors fetch 无法携带自定义头（SameSite=None 跨站部署时的关键防护）
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.headers['x-requested-with']) {
          throw new HttpError(403, 'missing X-Requested-With header');
        }
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') {
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
