<script setup>
// 云端保险库：登录用户，条目存服务器（AES-256-GCM 落盘），多端同步
import { ref, onMounted } from 'vue';
import { store, api } from '../store.js';
import { useVault, useTicker } from '../lib/useVault.js';
import { export2FaHubJson, exportOtpauthTxt, download } from '../lib/formats.js';
import OtpCard from '../components/OtpCard.vue';
import EntryModal from '../components/EntryModal.vue';
import ImportModal from '../components/ImportModal.vue';

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
  await api('/api/entries/bulk', { method: 'POST', body: { entries: list } });
  importing.value = false;
  await v.reload();
  v.showToast(`已导入 ${list.length} 条`);
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
  <div class="banner">
    ☁️ 云端模式 —— 条目加密存储在服务器，登录后多端同步。需要离线/不上传？切换到 <a href="/local" style="color: inherit">本地模式</a>。
  </div>

  <div class="toolbar">
    <input class="search" v-model="v.search.value" placeholder="搜索服务 / 账户…" />
    <button class="btn primary" @click="editing = {}">＋ 添加</button>
    <button class="btn" @click="importing = true">导入</button>
    <button class="btn" @click="showExport = !showExport">导出</button>
  </div>
  <div class="toolbar" v-if="showExport" style="margin-top: -8px">
    <button class="btn small" @click="doExport('json')">2fa-hub JSON（含 secret）</button>
    <button class="btn small" @click="doExport('txt')">otpauth:// 链接（txt）</button>
  </div>

  <div class="card-list" v-if="v.ready.value">
    <OtpCard
      v-for="e in v.filtered.value" :key="e.id" :entry="e" :now="now"
      :on-hotp-use="v.advanceHotp"
      @edit="editing = $event" @delete="v.removeEntry" @toast="v.showToast" @move="(d) => v.move(e, d)"
    />
  </div>
  <div class="empty" v-if="v.ready.value && !v.entries.value.length">
    还没有条目。<br />点击「＋ 添加」或「导入」从其他验证器迁移。
  </div>
  <div class="empty" v-if="!v.ready.value">加载中…</div>

  <EntryModal v-if="editing !== null" :initial="editing.id ? editing : null"
    @save="editing = null; v.saveEntry($event)" @cancel="editing = null" @toast="v.showToast" />
  <ImportModal v-if="importing" @import="doImport" @cancel="importing = false" />

  <div class="toast" v-if="v.toast.value">{{ v.toast.value }}</div>
</template>
