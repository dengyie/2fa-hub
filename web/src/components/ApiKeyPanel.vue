<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../store.js';
import UiIcon from './ui/UiIcon.vue';
import LiquidGlass from './ui/LiquidGlass.vue';

const props = defineProps({ entries: { type: Array, default: () => [] } });
const open = ref(false);
const keys = ref([]);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const createdValue = ref('');
const name = ref('');
const tier = ref('code');
const entryIds = ref([]);
const allEntries = ref(false);

watch(tier, (value) => {
  if (value === 'code') allEntries.value = false;
});

const tierHelp = computed(() => ({
  code: '只能获取选中条目的当前验证码，适合 Agent 日常登录。',
  read: '可列出条目元数据并获取验证码，永远不会返回 secret。',
  manage: '可通过 API 新增、修改、删除条目；仍不会读取已有 secret。',
}[tier.value]));

async function load() {
  loading.value = true;
  error.value = '';
  try { keys.value = (await api('/api/keys')).keys; }
  catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}

async function show() {
  open.value = true;
  createdValue.value = '';
  await load();
}

async function create() {
  error.value = '';
  if (!name.value.trim()) { error.value = '请先填写名称'; return; }
  const useAll = tier.value !== 'code' && allEntries.value;
  if (!useAll && !entryIds.value.length) { error.value = '请选择至少一个条目，或切换为全部条目'; return; }
  busy.value = true;
  try {
    const result = await api('/api/keys', {
      method: 'POST',
      body: { name: name.value.trim(), tier: tier.value, entry_ids: useAll ? null : entryIds.value },
    });
    createdValue.value = result.value;
    keys.value.unshift(result.key);
    name.value = '';
    entryIds.value = [];
    allEntries.value = false;
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

async function revoke(key) {
  if (!confirm(`撤销 API key「${key.name}」？已接入的 Agent 会立即失效。`)) return;
  try {
    await api(`/api/keys/${key.id}`, { method: 'DELETE' });
    key.revoked_at = new Date().toISOString();
  } catch (e) { error.value = e.message; }
}

async function copyCreated() {
  await navigator.clipboard.writeText(createdValue.value);
}
</script>

<template>
  <button class="glass-btn flex items-center gap-1.5 px-3.5 py-2 text-sm" @click="show">
    <UiIcon name="key" size="15" />Agent API
  </button>

  <div v-if="open" class="fixed inset-0 z-50 bg-black/50 backdrop-blur-md p-4 overflow-y-auto flex items-center justify-center" @click.self="open = false">
    <LiquidGlass
      variant="modal"
      intensity="thick"
      :interactive="false"
      className="w-full max-w-2xl mx-auto my-auto p-6 sm:p-7 shadow-2xl border border-white/70 dark:border-white/12"
    >
      <div class="flex items-center gap-3 mb-4">
        <div class="w-8 h-8 rounded-xl bg-blue-600/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
          <UiIcon name="key" size="17" />
        </div>
        <div>
          <h2 class="font-bold text-base text-zinc-900 dark:text-zinc-100">Agent Machine API Keys</h2>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">原始 key 只在创建成功时展示一次；服务端仅保存安全哈希摘要。</p>
        </div>
        <button class="ml-auto p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-white/40 dark:hover:bg-white/10 transition-colors" @click="open = false">
          <UiIcon name="x" size="17" />
        </button>
      </div>

      <div v-if="createdValue" class="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 mb-4 shadow-sm">
        <div class="text-xs font-semibold text-amber-700 dark:text-amber-300">请立即复制，此 key 关闭窗口后将永久无法再次查看：</div>
        <div class="flex gap-2 mt-2">
          <code class="flex-1 break-all rounded-xl bg-white/80 dark:bg-zinc-950/80 px-3 py-2 text-xs font-mono border border-white/40 dark:border-white/5 select-all">{{ createdValue }}</code>
          <button class="glass-btn-primary shrink-0 px-3.5 text-xs" @click="copyCreated">复制</button>
        </div>
      </div>

      <form class="rounded-2xl border border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/5 p-4 mb-5 space-y-3 shadow-2xs" @submit.prevent="create">
        <div class="grid sm:grid-cols-2 gap-3">
          <label class="text-xs font-medium text-zinc-600 dark:text-zinc-300">名称
            <input v-model="name" placeholder="例如：LockKey / Agent" class="glass-input mt-1.5 w-full text-xs" />
          </label>
          <label class="text-xs font-medium text-zinc-600 dark:text-zinc-300">权限档位
            <select v-model="tier" class="glass-input mt-1.5 w-full text-xs">
              <option value="code">出码（仅获取 TOTP 验证码，推荐）</option>
              <option value="read">只读 + 出码（可查看条目元数据）</option>
              <option value="manage">管理 + 出码（可增删改条目）</option>
            </select>
          </label>
        </div>
        <p class="text-[11px] text-zinc-500 dark:text-zinc-400 leading-normal">{{ tierHelp }}</p>
        <label class="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
          <input v-model="allEntries" type="checkbox" :disabled="tier === 'code'" class="rounded" />
          <span>允许访问所有条目（包含未来新增）</span>
        </label>
        <label v-if="!allEntries" class="block text-xs font-medium text-zinc-600 dark:text-zinc-300">允许访问的特定条目
          <select v-model="entryIds" multiple class="glass-input mt-1.5 w-full h-24 text-xs font-mono">
            <option v-for="entry in props.entries" :key="entry.id" :value="entry.id">#{{ entry.id }} · {{ entry.issuer || '未命名服务' }} · {{ entry.label || '未命名账户' }}</option>
          </select>
        </label>
        <button :disabled="busy" class="glass-btn-primary px-4 py-2 text-xs sm:text-sm disabled:opacity-50">创建 API Key</button>
      </form>

      <p v-if="error" class="text-xs text-red-600 dark:text-red-400 mb-3 font-medium">{{ error }}</p>
      <div v-if="loading" class="text-xs text-zinc-400 py-3 text-center">
        <UiIcon name="loader" size="18" class="animate-spin inline-block mr-1 text-blue-500" />
        加载密钥列表中…
      </div>
      <div v-else class="space-y-2 max-h-56 overflow-y-auto pr-1">
        <div v-for="key in keys" :key="key.id" class="flex items-center gap-3 rounded-xl border border-white/60 dark:border-white/10 bg-white/40 dark:bg-white/5 p-3 hover:bg-white/60 dark:hover:bg-white/10 transition-colors">
          <div class="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
            <UiIcon name="key" size="15" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs sm:text-sm font-semibold truncate text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
              <span>{{ key.name }}</span>
              <span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">{{ key.tier }}</span>
            </div>
            <div class="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono mt-0.5">{{ key.prefix }}… · 创建于 {{ key.created_at }}<span v-if="key.last_used_at"> · 最近使用 {{ key.last_used_at }}</span></div>
          </div>
          <button v-if="!key.revoked_at" class="glass-btn text-xs text-red-600 dark:text-red-400 px-2.5 py-1 rounded-lg hover:border-red-500" @click="revoke(key)">撤销</button>
          <span v-else class="text-[11px] text-zinc-400 px-2">已撤销</span>
        </div>
        <p v-if="!keys.length" class="text-xs text-zinc-400 dark:text-zinc-500 py-4 text-center">暂未创建任何 Agent API Key。</p>
      </div>
    </LiquidGlass>
  </div>
</template>
