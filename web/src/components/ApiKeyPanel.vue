<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../store.js';
import UiIcon from './ui/UiIcon.vue';

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
  <button class="flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-blue-500 px-3.5 py-2 text-sm transition-colors" @click="show">
    <UiIcon name="key" size="15" />Agent API
  </button>

  <div v-if="open" class="fixed inset-0 z-40 bg-black/30 p-4 overflow-y-auto" @click.self="open = false">
    <section class="max-w-2xl mx-auto mt-10 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-5 sm:p-6">
      <div class="flex items-center gap-3 mb-4">
        <div>
          <h2 class="font-semibold">Agent API keys</h2>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">原始 key 只在创建成功时展示一次；服务端只保存不可逆摘要。</p>
        </div>
        <button class="ml-auto text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" @click="open = false"><UiIcon name="x" size="17" /></button>
      </div>

      <div v-if="createdValue" class="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 mb-4">
        <div class="text-xs font-semibold text-amber-700 dark:text-amber-300">请立即复制，此 key 关闭窗口后不会再次显示</div>
        <div class="flex gap-2 mt-2">
          <code class="flex-1 break-all rounded-lg bg-white/70 dark:bg-zinc-950 px-2.5 py-2 text-xs">{{ createdValue }}</code>
          <button class="shrink-0 rounded-lg bg-amber-600 text-white px-3 text-xs" @click="copyCreated">复制</button>
        </div>
      </div>

      <form class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3.5 mb-5 space-y-3" @submit.prevent="create">
        <div class="grid sm:grid-cols-2 gap-3">
          <label class="text-xs text-zinc-500 dark:text-zinc-400">名称
            <input v-model="name" placeholder="例如：LockKey / Agent" class="mt-1.5 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm" />
          </label>
          <label class="text-xs text-zinc-500 dark:text-zinc-400">权限档
            <select v-model="tier" class="mt-1.5 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm">
              <option value="code">出码（推荐）</option>
              <option value="read">只读 + 出码</option>
              <option value="manage">条目管理 + 出码</option>
            </select>
          </label>
        </div>
        <p class="text-[11px] text-zinc-500 dark:text-zinc-400">{{ tierHelp }}</p>
        <label class="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <input v-model="allEntries" type="checkbox" :disabled="tier === 'code'" />
          全部条目
        </label>
        <label v-if="!allEntries" class="block text-xs text-zinc-500 dark:text-zinc-400">允许访问的条目
          <select v-model="entryIds" multiple class="mt-1.5 w-full h-24 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm">
            <option v-for="entry in props.entries" :key="entry.id" :value="entry.id">#{{ entry.id }} · {{ entry.issuer || '未命名服务' }} · {{ entry.label || '未命名账户' }}</option>
          </select>
        </label>
        <button :disabled="busy" class="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium px-3.5 py-2 text-sm">创建 API key</button>
      </form>

      <p v-if="error" class="text-xs text-red-600 dark:text-red-400 mb-3">{{ error }}</p>
      <div v-if="loading" class="text-xs text-zinc-500">加载中…</div>
      <div v-else class="space-y-2">
        <div v-for="key in keys" :key="key.id" class="flex items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
          <UiIcon name="key" size="15" class="text-blue-500 shrink-0" />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium truncate">{{ key.name }} <span class="text-[10px] text-zinc-400">{{ key.tier }}</span></div>
            <div class="text-[11px] text-zinc-500 dark:text-zinc-400">{{ key.prefix }}… · 创建于 {{ key.created_at }}<span v-if="key.last_used_at"> · 最近使用 {{ key.last_used_at }}</span></div>
          </div>
          <button v-if="!key.revoked_at" class="text-xs text-red-600 dark:text-red-400 hover:underline" @click="revoke(key)">撤销</button>
          <span v-else class="text-[11px] text-zinc-400">已撤销</span>
        </div>
        <p v-if="!keys.length" class="text-xs text-zinc-500 dark:text-zinc-400 py-3">还没有 API key。</p>
      </div>
    </section>
  </div>
</template>
