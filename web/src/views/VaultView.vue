<script setup>
// 云端保险库：登录用户，条目存服务器（AES-256-GCM 落盘），多端同步
import { ref, onMounted } from 'vue';
import { store, api } from '../store.js';
import { useVault, useTicker } from '../lib/useVault.js';
import { loadLocalVault, wipeLocalVault } from '../lib/localvault.js';
import { export2FaHubJson, exportOtpauthTxt, download } from '../lib/formats.js';
import OtpCard from '../components/OtpCard.vue';
import EntryModal from '../components/EntryModal.vue';
import UploadQrModal from '../components/UploadQrModal.vue';
import ImportModal from '../components/ImportModal.vue';
import QrModal from '../components/QrModal.vue';
import UiIcon from '../components/ui/UiIcon.vue';
import ApiKeyPanel from '../components/ApiKeyPanel.vue';
import LiquidGlass from '../components/ui/LiquidGlass.vue';

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
const qrEntry = ref(null);
const importing = ref(false);
const showExport = ref(false);
const uploadingQr = ref(false);
const localCount = ref(0);
const localEntries = ref([]);
const showMigrateBanner = ref(false);

onMounted(async () => {
  v.reload().catch((e) => {
    if (e.status === 401) location.href = '/login';
    else v.showToast(`加载失败：${e.message}`, true);
  });
  try {
    const isDismissed = sessionStorage.getItem('2fahub.local.migrate_dismissed');
    const isMigrated = localStorage.getItem('2fahub.local.migrated');
    if (!isDismissed && !isMigrated) {
      const local = await loadLocalVault();
      if (!local.encrypted && local.entries?.length > 0) {
        localEntries.value = local.entries;
        localCount.value = local.entries.length;
        showMigrateBanner.value = true;
      }
    }
  } catch {
    // 加密库或无法读取时不打扰
  }
});

function dismissMigrateBanner() {
  showMigrateBanner.value = false;
  sessionStorage.setItem('2fahub.local.migrate_dismissed', '1');
}

async function migrateLocalToCloud() {
  await v.run(async () => {
    await api('/api/entries/bulk', { method: 'POST', body: { entries: localEntries.value } });
    await v.reload();
    showMigrateBanner.value = false;
    localStorage.setItem('2fahub.local.migrated', '1');
    const count = localCount.value;
    if (confirm(`已成功将 ${count} 个本地条目同步至云端！\n是否清空本地暂存条目以避免数据重复混淆？`)) {
      wipeLocalVault();
      localEntries.value = [];
      localCount.value = 0;
    }
    v.showToast(`已将 ${count} 个本地条目同步至云端`);
  });
}

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
  <!-- 云端提示栏 (Liquid Glass Capsule Alert) -->
  <LiquidGlass
    variant="none"
    intensity="light"
    :enableTilt="false"
    className="flex items-start gap-2.5 rounded-2xl border border-blue-500/25 bg-blue-500/10 dark:bg-blue-500/15 text-blue-900 dark:text-blue-200 text-xs sm:text-[13px] px-4 py-3 my-3 leading-relaxed shadow-[inset_0_1px_1px_rgba(255,255,255,0.7)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]"
  >
    <UiIcon name="cloud" size="16" class="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
    <span>云端模式 —— 条目加密存储在服务器，登录后多端同步。需要离线/不上传？切换到
      <router-link to="/local" class="underline underline-offset-2 font-medium hover:text-blue-600 dark:hover:text-blue-300">本地模式</router-link>。</span>
  </LiquidGlass>

  <!-- 本地数据一键上云引导 (Liquid Glass Alert) -->
  <LiquidGlass
    v-if="showMigrateBanner && localCount > 0"
    variant="none"
    intensity="light"
    :enableTilt="false"
    className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/15 text-zinc-900 dark:text-amber-100 text-xs px-4 py-3 my-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.7)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]"
  >
    <div class="flex items-center gap-2.5">
      <div class="w-7 h-7 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
        <UiIcon name="upload" size="15" />
      </div>
      <span>检测到本机浏览器有 <b>{{ localCount }}</b> 个本地 2FA 条目，是否一键导入到云端账号同步？</span>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <button class="glass-btn-primary px-3 py-1 text-xs" @click="migrateLocalToCloud">
        一键导入
      </button>
      <button class="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors" @click="dismissMigrateBanner">
        <UiIcon name="x" size="14" />
      </button>
    </div>
  </LiquidGlass>

  <!-- 搜索与操作悬浮工具栏 (Liquid Glass Action Bar) -->
  <div class="flex gap-2.5 mb-4 flex-wrap items-center">
    <div class="relative flex-1 min-w-[180px]">
      <UiIcon name="search" size="15" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
      <input
        v-model="v.search.value"
        placeholder="搜索服务 / 账户…"
        class="glass-input w-full pl-9 pr-3.5 py-2 text-sm"
      />
    </div>
    <button class="glass-btn-primary flex items-center gap-1.5 px-4 py-2 text-sm" @click="editing = {}">
      <UiIcon name="plus" size="15" />添加
    </button>
    <button class="glass-btn flex items-center gap-1.5 px-3.5 py-2 text-sm" @click="uploadingQr = true">
      <UiIcon name="image" size="15" />上传二维码
    </button>
    <ApiKeyPanel :entries="v.entries.value" />
    <button class="glass-btn flex items-center gap-1.5 px-3.5 py-2 text-sm" @click="importing = true">
      <UiIcon name="upload" size="15" />导入
    </button>
    <div class="relative">
      <button class="glass-btn flex items-center gap-1.5 px-3.5 py-2 text-sm" @click="showExport = !showExport">
        <UiIcon name="download" size="15" />导出
      </button>
      <LiquidGlass
        v-if="showExport"
        variant="none"
        intensity="thick"
        :interactive="false"
        className="absolute right-0 top-full mt-2 z-20 rounded-2xl border border-white/60 dark:border-white/10 bg-white/90 dark:bg-zinc-900/90 shadow-2xl py-1.5 w-56 text-sm backdrop-blur-xl"
      >
        <button class="w-full text-left px-4 py-2 hover:bg-white/60 dark:hover:bg-white/10 flex items-center gap-2 text-zinc-700 dark:text-zinc-200 transition-colors" @click="doExport('json')">
          <UiIcon name="download" size="14" />JSON（含 secret）
        </button>
        <button class="w-full text-left px-4 py-2 hover:bg-white/60 dark:hover:bg-white/10 flex items-center gap-2 text-zinc-700 dark:text-zinc-200 transition-colors" @click="doExport('txt')">
          <UiIcon name="download" size="14" />otpauth:// 链接（txt）
        </button>
      </LiquidGlass>
    </div>
  </div>

  <!-- 条目网格布局 -->
  <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 sm:gap-4.5" v-if="v.ready.value">
    <OtpCard
      v-for="e in v.filtered.value" :key="e.id" :entry="e" :now="now"
      :on-hotp-use="v.advanceHotp"
      @edit="editing = $event" @delete="v.removeEntry" @toast="v.showToast" @move="(d) => v.move(e, d)"
      @qr="qrEntry = $event"
    />
  </div>

  <!-- 搜索无结果 -->
  <LiquidGlass
    v-if="v.ready.value && v.entries.value.length > 0 && !v.filtered.value.length"
    variant="card"
    intensity="light"
    :interactive="false"
    className="text-center py-10 px-4 my-3"
  >
    <div class="w-10 h-10 rounded-2xl bg-zinc-200/50 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-2 text-zinc-400">
      <UiIcon name="search" size="20" />
    </div>
    <p class="font-semibold text-zinc-700 dark:text-zinc-300">未找到匹配条目</p>
    <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">没有包含「{{ v.search.value }}」的服务或账户</p>
  </LiquidGlass>

  <!-- 保险库完全为空 -->
  <LiquidGlass
    v-if="v.ready.value && !v.entries.value.length"
    variant="card"
    intensity="light"
    :interactive="false"
    className="text-center py-16 px-4 my-4"
  >
    <div class="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.7)] dark:shadow-none">
      <UiIcon name="cloud" size="24" />
    </div>
    <p class="font-semibold text-zinc-800 dark:text-zinc-200 mb-1">云端保险库暂无条目</p>
    <p class="text-xs text-zinc-400 dark:text-zinc-500 max-w-sm mx-auto mb-5 leading-relaxed">
      所有数据均以 AES-256-GCM 高强度加密落盘。<br />点击「上传二维码」「添加」或「导入」从其他验证器迁移。
    </p>
    <div class="flex items-center justify-center gap-2.5 flex-wrap">
      <button class="glass-btn-primary px-4 py-2 text-xs sm:text-sm" @click="editing = {}">
        <UiIcon name="plus" size="14" class="inline mr-1" />添加条目
      </button>
      <button class="glass-btn px-4 py-2 text-xs sm:text-sm" @click="uploadingQr = true">
        <UiIcon name="image" size="14" class="inline mr-1" />上传二维码
      </button>
      <button class="glass-btn px-4 py-2 text-xs sm:text-sm" @click="importing = true">
        <UiIcon name="upload" size="14" class="inline mr-1" />导入数据
      </button>
    </div>
  </LiquidGlass>

  <!-- 加载状态 -->
  <div class="text-center text-sm text-zinc-500 dark:text-zinc-400 py-16" v-if="!v.ready.value">
    <UiIcon name="loader" size="24" class="inline-block animate-spin text-blue-600 dark:text-blue-400" />
  </div>

  <!-- 弹窗组件 -->
  <EntryModal v-if="editing !== null" :initial="editing.id ? editing : null"
    @save="editing = null; v.saveEntry($event)" @cancel="editing = null" @toast="v.showToast" />
  <ImportModal v-if="importing" @import="doImport" @cancel="importing = false" />
  <UploadQrModal v-if="uploadingQr" @save="uploadingQr = false; v.saveEntry($event)" @cancel="uploadingQr = false" />
  <QrModal v-if="qrEntry" :entry="qrEntry" @close="qrEntry = null" @toast="v.showToast" />

  <!-- 浮动 Liquid Glass Toast 提示 -->
  <LiquidGlass
    v-if="v.toast.value"
    variant="capsule"
    intensity="thick"
    :interactive="false"
    className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 shadow-2xl border text-sm font-medium"
    :class="v.toastError.value
      ? 'border-red-500/40 text-red-600 dark:text-red-400 bg-white/90 dark:bg-zinc-900/90'
      : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-white/90 dark:bg-zinc-900/90'"
  >
    <span class="inline-flex items-center gap-2">
      <UiIcon :name="v.toastError.value ? 'circle-x' : 'check'" size="15" />
      {{ v.toast.value }}
    </span>
  </LiquidGlass>
</template>
