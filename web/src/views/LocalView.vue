<script setup>
// 本地模式（游客）：条目只存本机浏览器 localStorage，绝不经过网络。
// 可选口令加密整库（PBKDF2 + AES-GCM）。
import { ref, onMounted } from 'vue';
import { store } from '../store.js';
import { useVault, useTicker } from '../lib/useVault.js';
import { loadLocalVault, saveLocalVault, wipeLocalVault } from '../lib/localvault.js';
import { export2FaHubJson, exportOtpauthTxt, download } from '../lib/formats.js';
import OtpCard from '../components/OtpCard.vue';
import EntryModal from '../components/EntryModal.vue';
import UploadQrModal from '../components/UploadQrModal.vue';
import ImportModal from '../components/ImportModal.vue';
import QuickOtp from '../components/QuickOtp.vue';
import QrModal from '../components/QrModal.vue';
import UiIcon from '../components/ui/UiIcon.vue';
import LiquidGlass from '../components/ui/LiquidGlass.vue';

const now = useTicker();

// ---- 存储后端：纯本地 ----
let passphrase = sessionStorage.getItem('2fahub.local.unlock') || null;
const locked = ref(false);
const encrypted = ref(false);
const unlockPass = ref('');
const newPass = ref('');
const showLockPanel = ref(false);

const backend = {
  async load() {
    const { entries, encrypted: enc } = await loadLocalVault(passphrase);
    encrypted.value = enc;
    return entries;
  },
  async add(e) {
    const { entries } = await loadLocalVault(passphrase);
    entries.push({ ...e, id: Date.now() });
    await saveLocalVault(entries, passphrase);
  },
  async update(e) {
    const { entries } = await loadLocalVault(passphrase);
    const i = entries.findIndex((x) => x.id === e.id);
    if (i >= 0) entries[i] = { ...entries[i], ...e };
    await saveLocalVault(entries, passphrase);
  },
  async remove(e) {
    const { entries } = await loadLocalVault(passphrase);
    await saveLocalVault(entries.filter((x) => x.id !== e.id), passphrase);
  },
  async reorder(list) { await saveLocalVault(list, passphrase); },
  async advanceHotp() { /* 本地模式下 counter 直接在内存条目上推进，save 时落盘 */ },
};

const v = useVault(backend);

// 快速算码一键存入本地
async function handleQuickSave(e) {
  await v.saveEntry(e);
}

// HOTP 出码后推进本地计数器并持久化
async function advanceAndSave(e) {
  await backend.advanceHotp(e);
  await saveLocalVault(v.entries.value, passphrase);
}

onMounted(async () => {
  encrypted.value = localStorage.getItem('2fahub.local.vault.v1')
    ? JSON.parse(localStorage.getItem('2fahub.local.vault.v1')).enc
    : false;
  if (encrypted.value && !passphrase) {
    locked.value = true;
    return;
  }
  await v.reload();
});

async function unlock() {
  try {
    passphrase = unlockPass.value;
    await v.reload();
    sessionStorage.setItem('2fahub.local.unlock', passphrase);
    locked.value = false;
    v.showToast('已解锁');
  } catch {
    v.showToast('口令错误');
  }
}

async function relock() {
  sessionStorage.removeItem('2fahub.local.unlock');
  location.reload();
}

async function applyNewPass() {
  await saveLocalVault(v.entries.value, newPass.value || null);
  if (newPass.value) {
    passphrase = newPass.value;
    sessionStorage.setItem('2fahub.local.unlock', passphrase);
  } else {
    passphrase = null;
    sessionStorage.removeItem('2fahub.local.unlock');
  }
  encrypted.value = !!newPass.value;
  showLockPanel.value = false;
  newPass.value = '';
  v.showToast(newPass.value ? '已启用口令加密' : '已移除口令');
}

async function wipe() {
  if (!confirm('清空本地保险库？所有本地条目将被删除且无法恢复！')) return;
  wipeLocalVault();
  sessionStorage.removeItem('2fahub.local.unlock');
  passphrase = null;
  await v.reload();
  v.showToast('已清空');
}

async function doImport(list) {
  importing.value = false;
  await v.run(async () => {
    const { entries } = await loadLocalVault(passphrase);
    list.forEach((e) => entries.push({ ...e, id: Date.now() + entries.length }));
    await saveLocalVault(entries, passphrase);
    await v.reload();
    v.showToast(`已导入 ${list.length} 条`);
  });
}

function doExport(kind) {
  showExport.value = false;
  const ts = new Date().toISOString().slice(0, 10);
  if (kind === 'json') download(`2fa-hub-local-${ts}.json`, export2FaHubJson(v.entries.value));
  else download(`2fa-hub-local-${ts}.txt`, exportOtpauthTxt(v.entries.value), 'text/plain');
  v.showToast('注意：导出文件含明文 secret，请妥善保管');
}

const editing = ref(null);
const qrEntry = ref(null);
const importing = ref(false);
const showExport = ref(false);
const uploadingQr = ref(false);
</script>

<template>
  <!-- 本地安全模式胶囊横幅 (Liquid Glass Alert) -->
  <LiquidGlass
    variant="none"
    intensity="light"
    :enableTilt="false"
    className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-900 dark:text-emerald-200 text-xs sm:text-[13px] px-4 py-3 my-3 leading-relaxed shadow-[inset_0_1px_1px_rgba(255,255,255,0.7)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]"
  >
    <div class="flex items-start gap-2.5">
      <UiIcon name="shield" size="16" class="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <span>
        <b>免登本地模式</b> —— 纯前端离线安全计算，数据仅保留在当前浏览器中，<b>绝不上传服务器</b>。
        清除浏览器缓存会丢失条目，建议定期导出备份。
      </span>
    </div>
    <router-link
      v-if="!store.user"
      to="/login"
      class="shrink-0 font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 text-xs px-2.5 py-1 rounded-xl bg-white/40 dark:bg-white/10 hover:bg-white/60 transition-colors shadow-2xs"
    >
      <UiIcon name="cloud" size="13" />云端同步
    </router-link>
  </LiquidGlass>

  <!-- 本地保险库口令加锁状态 (Liquid Glass Modal/Card) -->
  <div class="max-w-sm mx-auto mt-[8vh] text-center" v-if="locked">
    <LiquidGlass variant="card" intensity="thick" className="p-6 sm:p-8">
      <div class="w-14 h-14 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-none">
        <UiIcon name="lock" size="30" strokeWidth="1.6" />
      </div>
      <h2 class="text-base font-bold text-zinc-900 dark:text-zinc-100">保险库已加密</h2>
      <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1 mb-5">输入主口令解密当前浏览器的 2FA 条目</p>
      <form class="space-y-3.5 text-left" @submit.prevent="unlock">
        <div>
          <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">解锁口令</label>
          <input
            v-model="unlockPass"
            type="password"
            autofocus
            placeholder="输入口令..."
            class="glass-input w-full"
          />
        </div>
        <button type="submit" class="glass-btn-primary w-full py-2.5 text-sm">
          解锁保险库
        </button>
      </form>
      <p class="text-[11px] text-zinc-400 dark:text-zinc-500 mt-4 leading-normal">忘记口令？只能清空本地数据重置（条目将丢失）。</p>
    </LiquidGlass>
  </div>

  <template v-else>
    <!-- ⚡️ 快速在线算码组件 -->
    <QuickOtp :now="now" class="my-3.5" @save-entry="handleQuickSave" @toast="v.showToast" />

    <!-- 悬浮操作工具栏 (Liquid Glass Toolbar) -->
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
            <UiIcon name="download" size="14" />otpauth:// 链接
          </button>
        </LiquidGlass>
      </div>
      <button class="glass-btn p-2" title="口令加密与本地数据管理" @click="showLockPanel = !showLockPanel">
        <UiIcon name="lock" size="16" />
      </button>
    </div>

    <!-- 加密口令设置面板 (Liquid Glass Dropdown Panel) -->
    <LiquidGlass
      v-if="showLockPanel"
      variant="none"
      intensity="light"
      :interactive="false"
      className="flex gap-2.5 mb-4 flex-wrap items-center rounded-2xl border border-white/60 dark:border-white/10 bg-white/70 dark:bg-white/5 backdrop-blur-md p-3 sm:p-3.5 shadow-sm"
    >
      <input
        v-model="newPass"
        class="glass-input flex-1 min-w-[200px] py-1.5"
        :placeholder="encrypted ? '输入新口令（留空移除加密）' : '设置口令加密整库（留空取消）'"
      />
      <button class="glass-btn-primary px-3.5 py-1.5 text-xs sm:text-sm" @click="applyNewPass">应用</button>
      <button v-if="encrypted" class="glass-btn flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm" @click="relock">
        <UiIcon name="lock" size="13" />立即锁定
      </button>
      <button class="glass-btn flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm text-red-600 dark:text-red-400 hover:border-red-500/40" @click="wipe">
        <UiIcon name="trash" size="13" />清空本地数据
      </button>
    </LiquidGlass>

    <!-- 条目网格布局 -->
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 sm:gap-4.5" v-if="v.ready.value">
      <OtpCard
        v-for="e in v.filtered.value" :key="e.id" :entry="e" :now="now"
        :on-hotp-use="advanceAndSave"
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

    <!-- 本地保险库完全为空 -->
    <LiquidGlass
      v-if="v.ready.value && !v.entries.value.length"
      variant="card"
      intensity="light"
      :interactive="false"
      className="text-center py-14 px-4 my-4"
    >
      <div class="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.7)] dark:shadow-none">
        <UiIcon name="shield" size="24" />
      </div>
      <p class="font-semibold text-zinc-800 dark:text-zinc-200 mb-1">本地保险库暂无保存条目</p>
      <p class="text-xs text-zinc-400 dark:text-zinc-500 max-w-sm mx-auto mb-5 leading-relaxed">
        所有数据保存在本地浏览器中，绝不上云。<br />上方可直接粘贴密钥临时算码，也可添加保存或导入已有条目。
      </p>
      <div class="flex items-center justify-center gap-2.5 flex-wrap">
        <button class="glass-btn-primary px-4 py-2 text-xs sm:text-sm" @click="uploadingQr = true">
          <UiIcon name="image" size="14" class="inline mr-1" />上传二维码图片
        </button>
        <button class="glass-btn px-4 py-2 text-xs sm:text-sm" @click="editing = {}">
          <UiIcon name="plus" size="14" class="inline mr-1" />手动录入
        </button>
        <button class="glass-btn px-4 py-2 text-xs sm:text-sm" @click="importing = true">
          <UiIcon name="upload" size="14" class="inline mr-1" />从其他验证器导入
        </button>
      </div>
    </LiquidGlass>

    <!-- 加载状态 -->
    <div class="text-center text-sm text-zinc-500 dark:text-zinc-400 py-16" v-if="!v.ready.value">
      <UiIcon name="loader" size="24" class="inline-block animate-spin text-blue-600 dark:text-blue-400" />
    </div>
  </template>

  <!-- 模态弹窗 -->
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
