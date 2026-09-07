// 保险库列表逻辑复用：云端与本地两个视图共用同一套列表/增删改/出码逻辑
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

export function useTicker() {
  const now = ref(Date.now());
  let t = 0;
  onMounted(() => { t = setInterval(() => (now.value = Date.now()), 1000); });
  onBeforeUnmount(() => clearInterval(t));
  return now;
}

export function useVault(backend) {
  const entries = ref([]);
  const search = ref('');
  const ready = ref(false);
  const toast = ref('');
  const toastError = ref(false);
  let toastTimer = 0;

  function showToast(msg, isError = false) {
    toast.value = msg;
    toastError.value = isError;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ''), isError ? 3200 : 1600);
  }

  const filtered = computed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return entries.value;
    return entries.value.filter((e) =>
      (e.issuer + ' ' + e.label).toLowerCase().includes(q));
  });

  async function reload() {
    entries.value = await backend.load();
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
    if (!confirm(`删除「${e.issuer || e.label}」？删除后无法恢复。`)) return;
    await run(async () => {
      await backend.remove(e);
      await reload();
    }, '已删除');
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

  return { entries, filtered, search, ready, toast, toastError, showToast, run, reload, saveEntry, removeEntry, move, advanceHotp };
}
