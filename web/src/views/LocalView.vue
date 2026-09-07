<script setup>
// 本地模式（游客）：条目只存本机浏览器 localStorage，绝不经过网络。
// 可选口令加密整库（PBKDF2 + AES-GCM）。
import { ref, onMounted } from 'vue';
import { useVault, useTicker } from '../lib/useVault.js';
import { loadLocalVault, saveLocalVault, wipeLocalVault } from '../lib/localvault.js';
import { export2FaHubJson, exportOtpauthTxt, download } from '../lib/formats.js';
import OtpCard from '../components/OtpCard.vue';
import EntryModal from '../components/EntryModal.vue';
import ImportModal from '../components/ImportModal.vue';

const now = useTicker();

// ---- 存储后端：纯本地 ----
let passphrase = sessionStorage.getItem('2fahub.local.unlock') || null;
const locked = ref(false);
const encrypted = ref(false);
const unlockPass = ref('');
const newPass = ref('');
const showLockPanel = ref(false);
const unlockedOnce = ref(false);

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
  unlockedOnce.value = true;
});

async function unlock() {
  try {
    passphrase = unlockPass.value;
    await v.reload();
    sessionStorage.setItem('2fahub.local.unlock', passphrase);
    locked.value = false;
    unlockedOnce.value = true;
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
  const { entries } = await loadLocalVault(passphrase);
  list.forEach((e) => entries.push({ ...e, id: Date.now() + entries.length }));
  await saveLocalVault(entries, passphrase);
  importing.value = false;
  await v.reload();
  v.showToast(`已导入 ${list.length} 条`);
}

function doExport(kind) {
  showExport.value = false;
  const ts = new Date().toISOString().slice(0, 10);
  if (kind === 'json') download(`2fa-hub-local-${ts}.json`, export2FaHubJson(v.entries.value));
  else download(`2fa-hub-local-${ts}.txt`, exportOtpauthTxt(v.entries.value), 'text/plain');
  v.showToast('注意：导出文件含明文 secret，请妥善保管');
}

const editing = ref(null);
const importing = ref(false);
const showExport = ref(false);
</script>

<template>
  <div class="banner warn">
    🔒 本地模式 —— 所有数据只保存在本机浏览器中，<b>不会上传服务器</b>。清除浏览器数据会丢失条目，请定期导出备份。
  </div>

  <!-- 加锁状态 -->
  <div class="auth-wrap" v-if="locked">
    <h1>🔐</h1>
    <p class="auth-sub">本地保险库已加密，输入口令解锁</p>
    <div class="auth-card">
      <form @submit.prevent="unlock">
        <div class="field">
          <label>解锁口令</label>
          <input v-model="unlockPass" type="password" autofocus />
        </div>
        <button class="btn primary" style="width: 100%">解锁</button>
      </form>
    </div>
    <p class="hint" style="text-align: center; margin-top: 12px">
      忘记口令？只能清除浏览器数据重置（条目将丢失）。
    </p>
  </div>

  <template v-else>
    <div class="toolbar">
      <input class="search" v-model="v.search.value" placeholder="搜索服务 / 账户…" />
      <button class="btn primary" @click="editing = {}">＋ 添加</button>
      <button class="btn" @click="importing = true">导入</button>
      <button class="btn" @click="showExport = !showExport">导出</button>
      <button class="btn" @click="showLockPanel = !showLockPanel">🔐</button>
    </div>

    <div class="toolbar" v-if="showExport" style="margin-top: -8px">
      <button class="btn small" @click="doExport('json')">JSON（含 secret）</button>
      <button class="btn small" @click="doExport('txt')">otpauth:// 链接</button>
    </div>

    <div class="toolbar" v-if="showLockPanel" style="margin-top: -8px">
      <input class="search" v-model="newPass" :placeholder="encrypted ? '输入新口令（留空移除加密）' : '设置口令加密整库（留空取消）'" />
      <button class="btn small" @click="applyNewPass">应用</button>
      <button v-if="encrypted" class="btn small" @click="relock">立即锁定</button>
      <button class="btn small danger" @click="wipe">清空本地数据</button>
    </div>

    <div class="card-list" v-if="v.ready.value">
      <OtpCard
        v-for="e in v.filtered.value" :key="e.id" :entry="e" :now="now"
        :on-hotp-use="advanceAndSave"
        @edit="editing = $event" @delete="v.removeEntry" @toast="v.showToast" @move="(d) => v.move(e, d)"
      />
    </div>
    <div class="empty" v-if="v.ready.value && !v.entries.value.length">
      本地保险库是空的。<br />点「＋ 添加」手动录入，或从其他验证器导入文件。
    </div>
    <div class="empty" v-if="!v.ready.value">加载中…</div>
  </template>

  <EntryModal v-if="editing !== null" :initial="editing.id ? editing : null"
    @save="editing = null; v.saveEntry($event)" @cancel="editing = null" @toast="v.showToast" />
  <ImportModal v-if="importing" @import="doImport" @cancel="importing = false" />

  <div class="toast" v-if="v.toast.value">{{ v.toast.value }}</div>
</template>
