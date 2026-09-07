import { reactive } from 'vue';

export const store = reactive({
  user: null,
  entries: [],      // 云端模式条目（含 secret，用于前端出码）
  bootstrap: { initialized: false, register_mode: 'open' },
});

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': '2fa-hub' } : { 'X-Requested-With': '2fa-hub' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function initSession() {
  try {
    const [me, boot] = await Promise.all([api('/api/me'), api('/api/bootstrap')]);
    store.user = me.user;
    store.bootstrap = boot;
  } catch {
    store.user = null;
    try { store.bootstrap = await api('/api/bootstrap'); } catch { /* 离线/服务器未启动 */ }
  }
}
