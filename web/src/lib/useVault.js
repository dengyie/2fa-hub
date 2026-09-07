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
  let toastTimer = 0;

  function showToast(msg) {
    toast.value = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ''), 1600);
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

  async function saveEntry(data) {
    if (data.id) await backend.update(data);
    else await backend.add(data);
    await reload();
    showToast(data.id ? '已保存' : '已添加');
  }

  async function removeEntry(e) {
    if (!confirm(`删除「${e.issuer || e.label}」？删除后无法恢复。`)) return;
    await backend.remove(e);
    await reload();
    showToast('已删除');
  }

  async function move(e, dir) {
    const list = [...entries.value];
    const i = list.findIndex((x) => x.id === e.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await backend.reorder(list);
    await reload();
  }

  async function advanceHotp(e) {
    e.counter = (Number(e.counter) || 0) + 1;
    await backend.advanceHotp(e);
  }

  return { entries, filtered, search, ready, toast, showToast, reload, saveEntry, removeEntry, move, advanceHotp };
}
