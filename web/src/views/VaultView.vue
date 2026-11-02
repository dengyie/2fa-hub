<script setup>
// 云端保险库：登录用户，条目存服务器（AES-256-GCM 落盘），多端同步
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
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
const activeFilter = ref('all');

const totpCount = computed(() => v.entries.value.filter((e) => (e.type || 'totp') === 'totp').length);
const hotpCount = computed(() => v.entries.value.filter((e) => e.type === 'hotp').length);

const displayList = computed(() => {
  let list = v.filtered.value;
  if (activeFilter.value === 'totp') {
    list = list.filter((e) => (e.type || 'totp') === 'totp');
  } else if (activeFilter.value === 'hotp') {
    list = list.filter((e) => e.type === 'hotp');
  }
  return list;
});

const searchInputRef = ref(null);
const exportWrapperRef = ref(null);
const cardRefs = ref({});

watch(displayList, () => {
  cardRefs.value = {};
});

// 回车快速提取：搜索框输入时按 Enter 直接复制首个匹配项验证码
function handleSearchEnter() {
  if (displayList.value.length > 0) {
    const first = displayList.value[0];
    const comp = cardRefs.value[first.id];
    if (comp?.copy) {
      comp.copy();
    }
  }
}

function clearSearch() {
  v.search.value = '';
  searchInputRef.value?.focus();
}

function onSearchEsc() {
  if (v.search.value) {
    v.search.value = '';
  } else {
    searchInputRef.value?.blur();
  }
}

function onGlobalKeydown(e) {
  // 弹窗打开时不响应全局快捷键
  if (editing.value !== null || importing.value || uploadingQr.value || qrEntry.value) {
    return;
  }
  // Esc 键关闭导出菜单或清除搜索
  if (e.key === 'Escape') {
    if (showExport.value) {
      showExport.value = false;
      return;
    }
    if (document.activeElement === searchInputRef.value) {
      onSearchEsc();
      return;
    }
  }
  // Cmd+K 或 Ctrl+K 或 / 快速聚焦搜索框
  const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
    return;
  }
  if (e.key === '/' && !isInput) {
    e.preventDefault();
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
    return;
  }
}

function onDocumentClick(e) {
  if (showExport.value && exportWrapperRef.value && !exportWrapperRef.value.contains(e.target)) {
    showExport.value = false;
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onGlobalKeydown);
  window.addEventListener('click', onDocumentClick);
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

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
  window.removeEventListener('click', onDocumentClick);
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

  <!-- 顶部仪表 Ribbon：标题、加密状态、条目统计与类型筛选器 -->
  <div class="flex items-center justify-between flex-wrap gap-3.5 my-4.5 px-1">
    <div>
      <div class="flex items-center gap-2.5">
        <h1 class="text-xl sm:text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
          云端保险库
        </h1>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          AES-256 加密同步
        </span>
      </div>
      <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
        共 {{ v.entries.value.length }} 个密钥安全托管
        <span v-if="v.search.value" class="text-blue-500 font-semibold">（搜索匹配 {{ displayList.length }} 项）</span>
      </p>
    </div>

    <!-- 分段切换药丸（全部 / TOTP / HOTP） -->
    <div class="flex items-center gap-1 p-1 rounded-2xl bg-black/5 dark:bg-white/5 border border-white/60 dark:border-white/10 backdrop-blur-sm text-xs font-semibold">
      <button
        class="px-3 py-1 rounded-xl transition-all cursor-pointer"
        :class="activeFilter === 'all' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'"
        @click="activeFilter = 'all'"
      >
        全部 ({{ v.entries.value.length }})
      </button>
      <button
        class="px-3 py-1 rounded-xl transition-all cursor-pointer"
        :class="activeFilter === 'totp' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'"
        @click="activeFilter = 'totp'"
      >
        TOTP ({{ totpCount }})
      </button>
      <button
        v-if="hotpCount > 0"
        class="px-3 py-1 rounded-xl transition-all cursor-pointer"
        :class="activeFilter === 'hotp' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'"
        @click="activeFilter = 'hotp'"
      >
        HOTP ({{ hotpCount }})
      </button>
    </div>
  </div>

  <!-- 搜索与操作悬浮工具栏 (Liquid Glass Action Bar) -->
  <div class="flex gap-2.5 mb-5 flex-wrap items-center">
    <!-- 智能搜索框 -->
    <div class="relative flex-1 min-w-[220px]">
      <UiIcon name="search" size="15" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
      <input
        ref="searchInputRef"
        v-model="v.search.value"
        placeholder="搜索服务名、账户（按 / 或 ⌘K 聚焦，Enter 复制首项）…"
        class="glass-input w-full pl-9 pr-24 py-2 text-sm"
        @keydown.enter="handleSearchEnter"
        @keydown.esc="onSearchEsc"
      />
      <!-- 搜索状态与快捷键胶囊 -->
      <div class="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
        <span
          v-if="v.search.value"
          class="text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
        >
          {{ displayList.length }} 项
        </span>
        <button
          v-if="v.search.value"
          type="button"
          class="pointer-events-auto text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-0.5 rounded-md transition-colors cursor-pointer"
          title="清空搜索"
          @click="clearSearch"
        >
          <UiIcon name="x" size="14" />
        </button>
        <kbd
          v-else
          class="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 dark:text-zinc-500 bg-black/5 dark:bg-white/5 border border-zinc-200 dark:border-zinc-800 rounded shadow-2xs select-none"
        >
          ⌘K
        </kbd>
      </div>
    </div>

    <!-- 主添加按钮 -->
    <button class="glass-btn-primary flex items-center gap-1.5 px-4 py-2 text-sm cursor-pointer" @click="editing = {}">
      <UiIcon name="plus" size="15" />添加密钥
    </button>

    <!-- 二维码上传识别 -->
    <button class="glass-btn flex items-center gap-1.5 px-3.5 py-2 text-sm cursor-pointer" @click="uploadingQr = true">
      <UiIcon name="image" size="15" />扫码上传
    </button>

    <!-- Agent Machine API 密钥面板 -->
    <ApiKeyPanel :entries="v.entries.value" />

    <!-- 导入数据 -->
    <button class="glass-btn flex items-center gap-1.5 px-3.5 py-2 text-sm cursor-pointer" @click="importing = true">
      <UiIcon name="upload" size="15" />导入
    </button>

    <!-- 导出数据下拉菜单 -->
    <div class="relative" ref="exportWrapperRef">
      <button class="glass-btn flex items-center gap-1.5 px-3.5 py-2 text-sm cursor-pointer" @click="showExport = !showExport">
        <UiIcon name="download" size="15" />导出
      </button>
      <LiquidGlass
        v-if="showExport"
        variant="none"
        intensity="thick"
        :interactive="false"
        className="absolute right-0 top-full mt-2 z-20 rounded-2xl border border-white/70 dark:border-white/10 bg-white/95 dark:bg-zinc-900/95 shadow-2xl py-1.5 w-56 text-sm backdrop-blur-xl"
      >
        <button class="w-full text-left px-4 py-2 hover:bg-white/60 dark:hover:bg-white/10 flex items-center gap-2 text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer" @click="doExport('json')">
          <UiIcon name="download" size="14" />JSON 文件（含密文备份）
        </button>
        <button class="w-full text-left px-4 py-2 hover:bg-white/60 dark:hover:bg-white/10 flex items-center gap-2 text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer" @click="doExport('txt')">
          <UiIcon name="download" size="14" />otpauth:// 链接列表
        </button>
      </LiquidGlass>
    </div>
  </div>

  <!-- 条目网格布局 -->
  <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5" v-if="v.ready.value">
    <OtpCard
      v-for="e in displayList" :key="e.id"
      :ref="(el) => { if (el) cardRefs[e.id] = el; }"
      :entry="e" :now="now"
      :on-hotp-use="v.advanceHotp"
      @edit="editing = $event" @delete="v.removeEntry" @toast="v.showToast" @move="(d) => v.move(e, d)"
      @qr="qrEntry = $event"
    />
  </div>

  <!-- 搜索无结果 -->
  <LiquidGlass
    v-if="v.ready.value && v.entries.value.length > 0 && !displayList.length"
    variant="card"
    intensity="light"
    :interactive="false"
    className="text-center py-12 px-4 my-4"
  >
    <div class="w-11 h-11 rounded-2xl bg-zinc-200/50 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-2.5 text-zinc-400">
      <UiIcon name="search" size="22" />
    </div>
    <p class="font-bold text-zinc-800 dark:text-zinc-200">未找到匹配条目</p>
    <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">没有包含「{{ v.search.value }}」的服务或账户</p>
    <button class="glass-btn mt-3 text-xs px-3 py-1.5" @click="v.search.value = ''">清除搜索关键词</button>
  </LiquidGlass>

  <!-- 保险库完全为空 -->
  <LiquidGlass
    v-if="v.ready.value && !v.entries.value.length"
    variant="card"
    intensity="light"
    :interactive="false"
    className="text-center py-16 px-4 my-4"
  >
    <div class="w-14 h-14 rounded-3xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-3.5 shadow-inner">
      <UiIcon name="cloud" size="28" />
    </div>
    <h3 class="font-bold text-base text-zinc-900 dark:text-zinc-100 mb-1">云端保险库暂无密钥</h3>
    <p class="text-xs text-zinc-400 dark:text-zinc-500 max-w-sm mx-auto mb-6 leading-relaxed">
      所有数据均使用 AES-256-GCM 独立加密后安全落盘。<br />点击下方快捷入口立即开始添加或导入。
    </p>
    <div class="flex items-center justify-center gap-3 flex-wrap">
      <button class="glass-btn-primary px-5 py-2.5 text-xs sm:text-sm cursor-pointer" @click="editing = {}">
        <UiIcon name="plus" size="15" class="inline mr-1" />手工添加密钥
      </button>
      <button class="glass-btn px-4 py-2.5 text-xs sm:text-sm cursor-pointer" @click="uploadingQr = true">
        <UiIcon name="image" size="15" class="inline mr-1" />上传二维码截图
      </button>
      <button class="glass-btn px-4 py-2.5 text-xs sm:text-sm cursor-pointer" @click="importing = true">
        <UiIcon name="upload" size="15" class="inline mr-1" />从其他验证器导入
      </button>
    </div>
  </LiquidGlass>

  <!-- 加载状态 -->
  <div class="text-center text-sm text-zinc-500 dark:text-zinc-400 py-20" v-if="!v.ready.value">
    <UiIcon name="loader" size="26" class="inline-block animate-spin text-blue-600 dark:text-blue-400" />
    <p class="text-xs text-zinc-400 mt-2 font-medium">正在安全解密保险库条目…</p>
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
    className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 shadow-2xl border text-sm font-semibold"
    :class="v.toastError.value
      ? 'border-red-500/40 text-red-600 dark:text-red-400 bg-white/95 dark:bg-zinc-900/95'
      : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-white/95 dark:bg-zinc-900/95'"
  >
    <span class="inline-flex items-center gap-2">
      <UiIcon :name="v.toastError.value ? 'circle-x' : 'check'" size="15" />
      {{ v.toast.value }}
    </span>
  </LiquidGlass>
</template>
