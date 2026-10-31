<script setup>
// 导入向导：支持 2fa-hub JSON / 纯文本 otpauth URI / 2FAS / Aegis 明文
import { ref } from 'vue';
import { detectAndParse } from '../lib/formats.js';
import UiIcon from './ui/UiIcon.vue';
import LiquidGlass from './ui/LiquidGlass.vue';

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
    if (!list.length) throw new Error('没有解析出任何有效条目');
    parsed.value = list;
  } catch (err) {
    error.value = err.message;
  }
}

function confirmImport() {
  emit('import', parsed.value.map(({ source, ...e }) => e));
}

const labelCls = 'block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5';
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-md flex items-start justify-center p-4 sm:p-6 overflow-y-auto" @click.self="emit('cancel')">
    <LiquidGlass
      variant="modal"
      intensity="thick"
      :interactive="false"
      className="w-full max-w-lg mx-auto my-auto p-6 sm:p-7 shadow-2xl border border-white/70 dark:border-white/12"
    >
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-blue-600/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <UiIcon name="upload" size="18" />
          </div>
          <h3 class="text-base font-bold text-zinc-900 dark:text-zinc-100 m-0">导入 2FA 条目</h3>
        </div>
        <button
          class="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-white/40 dark:hover:bg-white/10 transition-colors"
          @click="emit('cancel')"
        >
          <UiIcon name="x" size="16" />
        </button>
      </div>

      <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mb-4">
        支持：2fa-hub JSON · 纯文本 otpauth:// 链接（每行一条）· 2FAS 导出 · Aegis 明文导出。加密备份请先在原 App 解密。
      </p>

      <div class="mb-3.5" v-if="!parsed.length">
        <label :class="labelCls">
          <UiIcon name="file-text" size="12" class="inline-block align-[-1.5px] mr-1 text-blue-500" />
          选择导入文件（.json / .txt）
        </label>
        <input type="file" accept=".json,.txt,.md" class="glass-input w-full file:mr-3 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600/10 file:text-blue-600 dark:file:text-blue-400 hover:file:bg-blue-600/20" @change="onFile" />
      </div>

      <div class="mb-3.5" v-if="!parsed.length">
        <label :class="labelCls">或直接粘贴文本内容</label>
        <textarea
          v-model="rawText"
          rows="5"
          placeholder="otpauth://totp/GitHub:alice?secret=..."
          class="glass-input w-full font-mono text-xs leading-relaxed"
        ></textarea>
        <div class="flex justify-end mt-2">
          <button class="glass-btn px-4 py-1.5 text-xs font-semibold" @click="parse">
            立即解析
          </button>
        </div>
      </div>

      <p class="text-xs font-medium text-red-600 dark:text-red-400 my-2 px-1" v-if="error">{{ error }}</p>

      <template v-if="parsed.length">
        <div class="flex items-center justify-between mb-2 px-0.5">
          <span class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">成功识别到 {{ parsed.length }} 个条目：</span>
          <button class="text-xs text-blue-600 dark:text-blue-400 hover:underline" @click="parsed = []; rawText = ''">重新选择</button>
        </div>
        <div class="flex flex-col gap-1.5 max-h-60 overflow-y-auto rounded-2xl border border-white/60 dark:border-white/10 bg-white/40 dark:bg-white/5 backdrop-blur-sm p-2 shadow-inner">
          <div
            v-for="(e, i) in parsed"
            :key="i"
            class="flex items-center gap-2.5 rounded-xl border border-white/50 dark:border-white/5 bg-white/70 dark:bg-zinc-800/60 p-2.5 shadow-2xs"
          >
            <div class="w-7 h-7 shrink-0 rounded-lg bg-blue-600/15 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold uppercase shadow-2xs">
              {{ (e.issuer || e.label || '?').slice(0, 1) }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-xs font-bold truncate text-zinc-900 dark:text-zinc-100">{{ e.issuer || '(无服务名)' }}</div>
              <div class="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{{ e.label || '(无账户名)' }} · <span class="uppercase font-mono">{{ e.type }}</span></div>
            </div>
          </div>
        </div>
      </template>

      <div class="flex gap-2.5 justify-end mt-5 pt-2 border-t border-white/40 dark:border-white/5">
        <button class="glass-btn px-4 py-2 text-xs sm:text-sm font-medium" @click="emit('cancel')">取消</button>
        <button
          v-if="parsed.length"
          class="glass-btn-primary px-5 py-2 text-xs sm:text-sm font-semibold"
          @click="confirmImport"
        >
          全部导入（{{ parsed.length }}）
        </button>
      </div>
    </LiquidGlass>
  </div>
</template>
