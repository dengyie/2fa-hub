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

const btnGhost = 'flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-blue-500 px-3.5 py-2 text-sm transition-colors';
</script>

<template>
  <div class="flex items-start justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 text-[13px] px-3.5 py-2.5 my-3 leading-relaxed">
    <div class="flex items-start gap-2">
      <UiIcon name="shield" size="15" class="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <span>
        <b>免登本地模式</b> —— 纯前端离线安全计算，数据仅保留在当前浏览器中，<b>绝不上传服务器</b>。
        清除浏览器缓存会丢失条目，建议定期导出备份。
      </span>
    </div>
    <router-link v-if="!store.user" to="/login" class="shrink-0 font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 text-xs">
      <UiIcon name="cloud" size="13" />云端同步
    </router-link>
  </div>

  <!-- 加锁状态 -->
  <div class="max-w-sm mx-auto mt-[10vh] text-center" v-if="locked">
    <UiIcon name="lock" size="36" class="mx-auto text-zinc-400" strokeWidth="1.4" />
    <p class="text-[13px] text-zinc-500 dark:text-zinc-400 mt-3 mb-6">本地保险库已加密，输入口令解锁</p>
    <form class="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-3.5 text-left" @submit.prevent="unlock">
      <div>
        <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">解锁口令</label>
        <input v-model="unlockPass" type="password" autofocus
               class="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500 transition-colors" />
      </div>
      <button type="submit" class="w-full rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 text-sm transition-colors">解锁</button>
    </form>
    <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-4">忘记口令？只能清空本地数据重置（条目将丢失）。</p>
  </div>

  <template v-else>
    <!-- ⚡️ 快速在线算码组件 -->
    <QuickOtp :now="now" class="my-3.5" @save-entry="handleQuickSave" @toast="v.showToast" />

    <div class="flex gap-2 mb-4 flex-wrap items-center">
      <div class="relative flex-1 min-w-[160px]">
        <UiIcon name="search" size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
        <input v-model="v.search.value" placeholder="搜索服务 / 账户…"
               class="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-9 pr-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors" />
      </div>
      <button class="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold px-3.5 py-2 text-sm transition-colors" @click="editing = {}">
        <UiIcon name="plus" size="15" />添加
      </button>
      <button :class="btnGhost" @click="uploadingQr = true"><UiIcon name="image" size="15" />上传二维码</button>
      <button :class="btnGhost" @click="importing = true"><UiIcon name="upload" size="15" />导入</button>
      <div class="relative">
        <button :class="btnGhost" @click="showExport = !showExport"><UiIcon name="download" size="15" />导出</button>
        <div v-if="showExport" class="absolute right-0 top-full mt-1.5 z-20 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg py-1 w-56 text-sm">
          <button class="w-full text-left px-3.5 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2" @click="doExport('json')">
            <UiIcon name="download" size="14" />JSON（含 secret）
          </button>
          <button class="w-full text-left px-3.5 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2" @click="doExport('txt')">
            <UiIcon name="download" size="14" />otpauth:// 链接
          </button>
        </div>
      </div>
      <button :class="btnGhost" title="加密与数据管理" @click="showLockPanel = !showLockPanel"><UiIcon name="lock" size="15" /></button>
    </div>

    <div class="flex gap-2 mb-4 flex-wrap items-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 p-2.5" v-if="showLockPanel">
      <input v-model="newPass" class="flex-1 min-w-[200px] rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-blue-500 transition-colors"
             :placeholder="encrypted ? '输入新口令（留空移除加密）' : '设置口令加密整库（留空取消）'" />
      <button class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 text-sm transition-colors" @click="applyNewPass">应用</button>
      <button v-if="encrypted" class="flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:border-blue-500 transition-colors" @click="relock">
        <UiIcon name="lock" size="14" />立即锁定
      </button>
      <button class="flex items-center gap-1.5 rounded-lg border border-red-500/40 text-red-600 dark:text-red-400 px-3 py-1.5 text-sm hover:bg-red-500/10 transition-colors" @click="wipe">
        <UiIcon name="trash" size="14" />清空本地数据
      </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 sm:gap-4" v-if="v.ready.value">
      <OtpCard
        v-for="e in v.filtered.value" :key="e.id" :entry="e" :now="now"
        :on-hotp-use="advanceAndSave"
        @edit="editing = $event" @delete="v.removeEntry" @toast="v.showToast" @move="(d) => v.move(e, d)"
        @qr="qrEntry = $event"
      />
    </div>
    <div
      v-if="v.ready.value && v.entries.value.length > 0 && !v.filtered.value.length"
      class="text-center text-sm text-zinc-500 dark:text-zinc-400 py-10 px-4 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/30 my-2"
    >
      <UiIcon name="search" size="20" class="mx-auto text-zinc-400 mb-2" />
      <p class="font-medium text-zinc-700 dark:text-zinc-300">未找到匹配条目</p>
      <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">没有包含「{{ v.search.value }}」的服务或账户</p>
    </div>
    <div class="text-center text-sm text-zinc-500 dark:text-zinc-400 py-12 px-4 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 my-4" v-if="v.ready.value && !v.entries.value.length">
      <div class="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-3">
        <UiIcon name="shield" size="24" />
      </div>
      <p class="font-medium text-zinc-800 dark:text-zinc-200 mb-1">本地保险库暂无保存条目</p>
      <p class="text-xs text-zinc-400 dark:text-zinc-500 max-w-sm mx-auto mb-5 leading-relaxed">
        所有数据保存在本地浏览器中，绝不上云。<br />上方可直接粘贴密钥临时算码，也可添加保存或导入已有条目。
      </p>
      <div class="flex items-center justify-center gap-2 flex-wrap">
        <button class="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium px-3.5 py-2 text-xs transition-colors" @click="uploadingQr = true">
          <UiIcon name="image" size="14" />上传二维码图片
        </button>
        <button class="flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-blue-500 text-zinc-700 dark:text-zinc-300 font-medium px-3.5 py-2 text-xs transition-colors" @click="editing = {}">
          <UiIcon name="plus" size="14" />手动录入
        </button>
        <button class="flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-blue-500 text-zinc-700 dark:text-zinc-300 font-medium px-3.5 py-2 text-xs transition-colors" @click="importing = true">
          <UiIcon name="upload" size="14" />从其他验证器导入
        </button>
      </div>
    </div>
    <div class="text-center text-sm text-zinc-500 dark:text-zinc-400 py-16" v-if="!v.ready.value">
      <UiIcon name="loader" size="20" class="inline-block animate-spin" />
    </div>
  </template>

  <EntryModal v-if="editing !== null" :initial="editing.id ? editing : null"
    @save="editing = null; v.saveEntry($event)" @cancel="editing = null" @toast="v.showToast" />
  <ImportModal v-if="importing" @import="doImport" @cancel="importing = false" />
  <UploadQrModal v-if="uploadingQr" @save="uploadingQr = false; v.saveEntry($event)" @cancel="uploadingQr = false" />
  <QrModal v-if="qrEntry" :entry="qrEntry" @close="qrEntry = null" @toast="v.showToast" />

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
