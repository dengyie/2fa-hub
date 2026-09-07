<script setup>
// 云端保险库：登录用户，条目存服务器（AES-256-GCM 落盘），多端同步
import { ref, onMounted } from 'vue';
import { store, api } from '../store.js';
import { useVault, useTicker } from '../lib/useVault.js';
import { export2FaHubJson, exportOtpauthTxt, download } from '../lib/formats.js';
import OtpCard from '../components/OtpCard.vue';
import EntryModal from '../components/EntryModal.vue';
import ImportModal from '../components/ImportModal.vue';
import UiIcon from '../components/ui/UiIcon.vue';

const now = useTicker();
const backend = {
  async load() { return (await api('/api/entries/full')).entries; },
  async add(e) { await api('/api/entries', { method: 'POST', body: e }); },
  async update(e) { await api(`/api/entries/${e.id}`, { method: 'PUT', body: e }); },
  async remove(e) { await api(`/api/entries/${e.id}`, { method: 'DELETE' }); },
  async reorder(list) { await api('/api/entries-order', { method: 'PUT', body: { ids: list.map((e) => e.id) } }); },
  async advanceHotp(e) { await api(`/api/entries/${e.id}/counter`, { method: 'POST', body: {} }); },
};
const v = useVault(backend);

const editing = ref(null);   // null=关闭, {}=新建, entry=编辑
const importing = ref(false);
const showExport = ref(false);

onMounted(() => { v.reload().catch((e) => { if (e.status === 401) location.href = '/login'; }); });

async function doImport(list) {
  importing.value = false;
  await v.run(async () => {
    await api('/api/entries/bulk', { method: 'POST', body: { entries: list } });
    await v.reload();
    v.showToast(`已导入 ${list.length} 条`);
  });
}

function doExport(kind) {
  showExport.value = false;
  const ts = new Date().toISOString().slice(0, 10);
  if (kind === 'json') {
    download(`2fa-hub-${ts}.json`, export2FaHubJson(v.entries.value));
  } else {
    download(`2fa-hub-${ts}.txt`, exportOtpauthTxt(v.entries.value), 'text/plain');
  }
  v.showToast('注意：导出文件含明文 secret，请妥善保管');
}
</script>

<template>
  <div class="flex items-start gap-2 rounded-xl border border-blue-600/25 bg-blue-600/5 text-blue-700 dark:text-blue-300 text-[13px] px-3.5 py-2.5 my-3 leading-relaxed">
    <UiIcon name="cloud" size="15" class="mt-0.5 shrink-0" />
    <span>云端模式 —— 条目加密存储在服务器，登录后多端同步。需要离线/不上传？切换到
      <router-link to="/local" class="underline underline-offset-2">本地模式</router-link>。</span>
  </div>

  <div class="flex gap-2 mb-4 flex-wrap items-center">
    <div class="relative flex-1 min-w-[160px]">
      <UiIcon name="search" size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
      <input v-model="v.search.value" placeholder="搜索服务 / 账户…"
             class="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-9 pr-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors" />
    </div>
    <button class="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold px-3.5 py-2 text-sm transition-colors" @click="editing = {}">
      <UiIcon name="plus" size="15" />添加
    </button>
    <button class="flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-blue-500 px-3.5 py-2 text-sm transition-colors" @click="importing = true">
      <UiIcon name="upload" size="15" />导入
    </button>
    <div class="relative">
      <button class="flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-blue-500 px-3.5 py-2 text-sm transition-colors" @click="showExport = !showExport">
        <UiIcon name="download" size="15" />导出
      </button>
      <div v-if="showExport" class="absolute right-0 top-full mt-1.5 z-20 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg py-1 w-56 text-sm">
        <button class="w-full text-left px-3.5 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2" @click="doExport('json')">
          <UiIcon name="download" size="14" />JSON（含 secret）
        </button>
        <button class="w-full text-left px-3.5 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2" @click="doExport('txt')">
          <UiIcon name="download" size="14" />otpauth:// 链接（txt）
        </button>
      </div>
    </div>
  </div>

  <div class="flex flex-col gap-2.5" v-if="v.ready.value">
    <OtpCard
      v-for="e in v.filtered.value" :key="e.id" :entry="e" :now="now"
      :on-hotp-use="v.advanceHotp"
      @edit="editing = $event" @delete="v.removeEntry" @toast="v.showToast" @move="(d) => v.move(e, d)"
    />
  </div>
  <div class="text-center text-sm text-zinc-500 dark:text-zinc-400 py-16 leading-loose" v-if="v.ready.value && !v.entries.value.length">
    还没有条目。<br />点击「添加」或「导入」从其他验证器迁移。
  </div>
  <div class="text-center text-sm text-zinc-500 dark:text-zinc-400 py-16" v-if="!v.ready.value">
    <UiIcon name="loader" size="20" class="inline-block animate-spin" />
  </div>

  <EntryModal v-if="editing !== null" :initial="editing.id ? editing : null"
    @save="editing = null; v.saveEntry($event)" @cancel="editing = null" @toast="v.showToast" />
  <ImportModal v-if="importing" @import="doImport" @cancel="importing = false" />

  <div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg border px-4 py-2.5 text-sm shadow-lg"
       :class="v.toastError.value
         ? 'border-red-500/50 bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400'
         : 'border-emerald-500/50 bg-white dark:bg-zinc-900 text-emerald-600 dark:text-emerald-400'"
       v-if="v.toast.value">
    <span class="inline-flex items-center gap-1.5">
      <UiIcon :name="v.toastError.value ? 'circle-x' : 'check'" size="14" />{{ v.toast.value }}
    </span>
  </div>
</template>
