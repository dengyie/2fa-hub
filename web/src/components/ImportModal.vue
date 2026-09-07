<script setup>
// 导入向导：支持 otpocket JSON / 纯文本 otpauth URI / 2FAS / Aegis 明文
import { ref } from 'vue';
import { detectAndParse } from '../lib/formats.js';
import UiIcon from './ui/UiIcon.vue';

const emit = defineEmits(['import', 'cancel']);
const error = ref('');
const parsed = ref([]);
const rawText = ref('');

async function onFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  rawText.value = await file.text();
  parse();
}

function parse() {
  error.value = '';
  parsed.value = [];
  try {
    const list = detectAndParse(rawText.value);
    if (!list.length) throw new Error('没有解析出任何条目');
    parsed.value = list;
  } catch (err) {
    error.value = err.message;
  }
}

function confirmImport() {
  emit('import', parsed.value.map(({ source, ...e }) => e));
}

const inputCls = 'w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors';
const labelCls = 'block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5';
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-6 overflow-y-auto" @click.self="emit('cancel')">
    <div class="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-base font-semibold m-0 flex items-center gap-2"><UiIcon name="upload" size="17" />导入条目</h3>
        <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" @click="emit('cancel')">
          <UiIcon name="x" size="16" />
        </button>
      </div>
      <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mb-4">
        支持：2fa-hub JSON · 纯文本 otpauth:// 链接（每行一条）· 2FAS 导出 · Aegis 明文导出。加密的 Aegis 备份请先解密导出。
      </p>

      <div class="mb-3.5" v-if="!parsed.length">
        <label :class="labelCls"><UiIcon name="image" size="12" class="inline-block align-[-1.5px] mr-1" />选择文件</label>
        <input type="file" accept=".json,.txt,.md" :class="inputCls" @change="onFile" />
      </div>
      <div class="mb-3.5" v-if="!parsed.length">
        <label :class="labelCls">或粘贴内容</label>
        <textarea v-model="rawText" rows="5" placeholder="otpauth://totp/GitHub:alice?secret=..." :class="inputCls + ' otp-font'"></textarea>
        <button class="mt-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-[13px] hover:border-blue-500 transition-colors" @click="parse">解析</button>
      </div>

      <p class="text-[13px] text-red-600 dark:text-red-400 my-2" v-if="error">{{ error }}</p>

      <template v-if="parsed.length">
        <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-2">解析出 {{ parsed.length }} 条：</p>
        <div class="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          <div class="flex items-center gap-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2" v-for="(e, i) in parsed" :key="i">
            <div class="w-7 h-7 shrink-0 rounded-md bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold uppercase">
              {{ (e.issuer || e.label || '?').slice(0, 1) }}
            </div>
            <div class="min-w-0">
              <div class="text-[13px] font-semibold truncate">{{ e.issuer || '(无服务名)' }}</div>
              <div class="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{{ e.label || '(无账户名)' }} · {{ e.type }}</div>
            </div>
          </div>
        </div>
      </template>

      <div class="flex gap-2 justify-end mt-5">
        <button class="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm hover:border-blue-500 transition-colors" @click="emit('cancel')">取消</button>
        <button v-if="parsed.length" class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 text-sm transition-colors" @click="confirmImport">
          全部导入（{{ parsed.length }}）
        </button>
      </div>
    </div>
  </div>
</template>
