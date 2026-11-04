// 保险库列表逻辑复用：云端与本地两个视图共用同一套列表/增删改/出码/回收站逻辑
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { TRASH_RETENTION_DAYS } from '@shared/trash.js';

// 服务端标准时钟漂移对齐（消除客户端时钟偏差，保证 TOTP 绝对精准）
let serverOffsetMs = 0;
let synced = false;

export async function syncServerClock() {
  try {
    const t0 = performance.now();
    const res = await fetch('/api/health', { method: 'HEAD', cache: 'no-store' });
    const dateStr = res.headers.get('Date');
    if (!dateStr) return;
    const rtt = performance.now() - t0;
    const serverEpoch = new Date(dateStr).getTime() + rtt / 2;
    serverOffsetMs = serverEpoch - Date.now();
    synced = true;
  } catch {}
}

export function useTicker() {
  const now = ref(Date.now() + serverOffsetMs);
  let t = 0;
  function update() {
    now.value = Date.now() + serverOffsetMs;
  }
  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      syncServerClock().then(update);
    }
  }
  onMounted(() => {
    update();
    if (!synced) syncServerClock().then(update);
    t = setInterval(update, 1000);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });
  onBeforeUnmount(() => {
    clearInterval(t);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });
  return now;
}

export function useVault(backend, { retentionDays = TRASH_RETENTION_DAYS } = {}) {
  const entries = ref([]);
  const trash = ref([]);
  const search = ref('');
  const ready = ref(false);
  const toast = ref('');
  const toastError = ref(false);
  const showTrash = ref(false);
  const trashCount = ref(0);
  const trashLoading = ref(false);
  let toastTimer = 0;

  function showToast(msg, isError = false) {
    toast.value = msg;
    toastError.value = isError;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.value = '';
      toastError.value = false;
    }, isError ? 3200 : 1600);
  }

  const filtered = computed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return entries.value;
    return entries.value.filter((e) =>
      (e.issuer + ' ' + e.label).toLowerCase().includes(q));
  });

  // 打开回收站时才拉全量列表；角标数量由 backend.load() 返回，避免每次刷新多一次请求
  async function refreshTrash() {
    if (!backend.loadTrash) return;
    trashLoading.value = true;
    try {
      trash.value = await backend.loadTrash();
      trashCount.value = trash.value.length;
    } catch {
      // 回收站加载失败不阻断主库：保留上一次结果
    } finally {
      trashLoading.value = false;
    }
  }

  async function reload() {
    const data = await backend.load();
    entries.value = data.entries;
    trashCount.value = data.trashCount;
    ready.value = true;
  }

  // 所有变更操作的失败必须反馈给用户，禁止静默吞错（本地模式保存失败 = 数据丢失风险）
  async function run(fn, okMsg) {
    try {
      await fn();
      if (okMsg) showToast(okMsg);
      return true;
    } catch (err) {
      showToast(`操作失败：${err.message}`, true);
      return false;
    }
  }

  async function saveEntry(data) {
    await run(async () => {
      if (data.id) await backend.update(data);
      else await backend.add(data);
      await reload();
    }, data.id ? '已保存' : '已添加');
  }

  async function removeEntry(e) {
    const name = e.issuer || e.label;
    if (!confirm(`删除「${name}」？条目将移入垃圾箱，${retentionDays} 天后自动彻底删除，期间可随时恢复。`)) return false;
    return run(async () => {
      await backend.remove(e);
      await reload();
    }, `已移入垃圾箱（${retentionDays} 天后彻底删除）`);
  }

  // 垃圾箱变更后：reload 只带回角标数量，若面板正开着必须重新拉全量列表，否则残留已恢复/已清除的行
  async function afterTrashChange() {
    await reload();
    if (showTrash.value) await refreshTrash();
  }

  async function restoreEntry(e) {
    return run(async () => {
      await backend.restore(e);
      await afterTrashChange();
    }, '已恢复');
  }

  async function purgeEntry(e) {
    if (!confirm(`彻底删除「${e.issuer || e.label}」？此操作无法撤销。`)) return false;
    return run(async () => {
      await backend.purge(e);
      await afterTrashChange();
    }, '已彻底删除');
  }

  async function emptyTrash() {
    if (!trash.value.length) return false;
    if (!confirm(`彻底删除垃圾箱中的 ${trash.value.length} 个条目？此操作无法撤销。`)) return false;
    return run(async () => {
      await backend.emptyTrash();
      await afterTrashChange();
    }, '垃圾箱已清空');
  }

  async function move(e, dir) {
    const list = [...entries.value];
    const i = list.findIndex((x) => x.id === e.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await run(async () => {
      await backend.reorder(list);
      await reload();
    });
  }

  async function advanceHotp(e) {
    e.counter = (Number(e.counter) || 0) + 1;
    await run(() => backend.advanceHotp(e));
  }

  return {
    entries, trash, trashCount, trashLoading, filtered, search, ready, toast, toastError, showTrash,
    retentionDays, showToast, run, reload, refreshTrash,
    saveEntry, removeEntry, restoreEntry, purgeEntry, emptyTrash, move, advanceHotp,
  };
}
