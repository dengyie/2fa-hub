<script setup>
// ⚡️ 快速在线验码器（Quick OTP Scratchpad）
// 零门槛即开即用：粘贴 Base32 密钥或 otpauth:// 链接，实时出码 + 倒计时 + 一键存入本地
import { ref, computed, watch } from 'vue';
import { generateOtp } from '@shared/otp.js';
import { parseOtpauthUri, isOtpauthUri } from '@shared/otpauth.js';
import { normalizeBase32 } from '@shared/base32.js';
import UiIcon from './ui/UiIcon.vue';

const props = defineProps({
  now: { type: Number, required: true },
});

const emit = defineEmits(['save-entry', 'toast']);

const input = ref('');
const error = ref('');
const parsedEntry = ref(null);
const code = ref('······');
const remaining = ref(null);
const copied = ref(false);

// 解析输入框内容：支持 otpauth:// URI 或裸 Base32 密钥
function parseInput(val) {
  const s = String(val || '').trim();
  error.value = '';
  if (!s) {
    parsedEntry.value = null;
    return;
  }

  try {
    if (isOtpauthUri(s)) {
      const e = parseOtpauthUri(s);
      if (e.secret && e.secret.length < 8) {
        throw new Error('URI 包含的密钥过短（至少需 8 位 Base32）');
      }
      parsedEntry.value = e;
    } else {
      // 容错处理：用户可能输入包含空格/连字符的 Base32
      const cleanSecret = normalizeBase32(s);
      if (cleanSecret.length < 8) {
        throw new Error('密钥过短（至少需要 8 位 Base32 字符）');
      }
      parsedEntry.value = {
        type: 'totp',
        secret: cleanSecret,
        issuer: '',
        label: '在线验码',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        counter: 0,
      };
    }
  } catch (err) {
    parsedEntry.value = null;
    error.value = err.message && (err.message.includes('过短') || err.message.includes('Base32') || err.message.includes('otpauth'))
      ? err.message
      : '无效的 2FA 密钥或链接（需为 Base32 或 otpauth:// 格式）';
  }
}

watch(input, (val) => parseInput(val));

// 实时计算 OTP
let lastKey = '';
watch(
  () => [props.now, parsedEntry.value],
  async () => {
    if (!parsedEntry.value) {
      code.value = '······';
      remaining.value = null;
      lastKey = '';
      return;
    }

    const e = parsedEntry.value;
    const period = e.period || 30;
    const bucket = Math.floor(props.now / 1000 / period);
    const key = `${e.secret}|${e.type}|${bucket}|${period}|${e.algorithm}|${e.digits}`;

    if (key === lastKey) {
      remaining.value = period - (Math.floor(props.now / 1000) % period);
      return;
    }

    lastKey = key;
    try {
      const r = await generateOtp(e, props.now);
      code.value = r.code;
      remaining.value = r.remaining;
    } catch (err) {
      code.value = 'Error';
      error.value = `出码失败：${err.message}`;
    }
  },
  { immediate: true },
);

const progress = computed(() => {
  if (!parsedEntry.value || remaining.value == null) return 100;
  const period = parsedEntry.value.period || 30;
  return Math.max(0, Math.round((remaining.value / period) * 100));
});

const formattedCode = computed(() => {
  const c = code.value || '';
  if (c.length === 6) return `${c.slice(0, 3)} ${c.slice(3)}`;
  if (c.length === 8) return `${c.slice(0, 4)} ${c.slice(4)}`;
  return c;
});

async function copyCode() {
  if (!code.value || code.value === '······' || code.value === 'Error') return;
  try {
    if (!navigator?.clipboard?.writeText) {
      throw new Error('Clipboard API 不可用');
    }
    await navigator.clipboard.writeText(code.value);
    copied.value = true;
    emit('toast', '已复制验证码');
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    emit('toast', '复制失败，请手动选取', true);
  }
}

async function pasteFromClipboard() {
  try {
    if (!navigator?.clipboard?.readText) {
      throw new Error('Clipboard API 不可用');
    }
    const text = await navigator.clipboard.readText();
    if (text) input.value = text.trim();
  } catch {
    emit('toast', '未能读取剪贴板，请手动粘贴', true);
  }
}

function saveToVault() {
  if (!parsedEntry.value) return;
  emit('save-entry', { ...parsedEntry.value });
  input.value = '';
}
</script>

<template>
  <div class="rounded-2xl border border-blue-500/20 bg-gradient-to-b from-blue-500/5 to-transparent dark:from-blue-500/10 dark:to-transparent p-4 transition-all">
    <!-- 顶栏标题与快捷按钮 -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
        <UiIcon name="sparkles" size="15" />
        <span>在线快速验码 (Quick OTP)</span>
        <span class="text-zinc-400 dark:text-zinc-500 font-normal">· 粘贴即出码，不存网络</span>
      </div>
      <button v-if="!input" class="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors" @click="pasteFromClipboard">
        <UiIcon name="copy" size="13" />粘贴剪贴板
      </button>
      <button v-else class="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors" @click="input = ''">
        清空
      </button>
    </div>

    <!-- 输入栏 -->
    <div class="relative">
      <input
        v-model="input"
        type="text"
        placeholder="粘贴 2FA 密钥 (Base32，如 JBSWY3DPEHPK3PXP) 或 otpauth:// 链接..."
        class="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3.5 py-2.5 text-sm font-mono outline-none focus:border-blue-500 dark:focus:border-blue-500 transition-colors shadow-xs placeholder:font-sans placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
      />
      <button
        v-if="input"
        class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-md"
        @click="input = ''"
      >
        <UiIcon name="x" size="14" />
      </button>
    </div>

    <!-- 错误提示 -->
    <div v-if="error && input" class="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 mt-2 px-1">
      <UiIcon name="circle-x" size="13" />
      <span>{{ error }}</span>
    </div>

    <!-- 成功算码结果卡片 -->
    <div
      v-if="parsedEntry && !error"
      class="mt-3.5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white/90 dark:bg-zinc-900/90 backdrop-blur p-3.5 shadow-sm"
    >
      <div class="flex items-center gap-3">
        <!-- 倒计时圆环 -->
        <div class="relative w-10 h-10 shrink-0 flex items-center justify-center">
          <svg class="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
            <path
              class="text-zinc-100 dark:text-zinc-800"
              stroke-width="3"
              stroke="currentColor"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              :class="remaining != null && remaining <= 5 ? 'text-rose-500' : 'text-blue-500'"
              stroke-dasharray="100, 100"
              :stroke-dashoffset="100 - progress"
              stroke-linecap="round"
              stroke-width="3"
              stroke="currentColor"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
          <span class="absolute font-mono text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">
            {{ remaining != null ? `${remaining}s` : 'HOTP' }}
          </span>
        </div>

        <!-- 验证码与元信息 -->
        <div>
          <div class="flex items-baseline gap-2">
            <span class="font-mono text-2xl font-bold tracking-wider text-zinc-900 dark:text-zinc-100 select-all">
              {{ formattedCode }}
            </span>
          </div>
          <div class="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            <span v-if="parsedEntry.issuer" class="font-medium text-zinc-700 dark:text-zinc-300">
              {{ parsedEntry.issuer }}
            </span>
            <span v-if="parsedEntry.label && parsedEntry.issuer">·</span>
            <span v-if="parsedEntry.label">{{ parsedEntry.label }}</span>
            <span class="text-zinc-400 dark:text-zinc-600">({{ parsedEntry.algorithm }}, {{ parsedEntry.digits }}位)</span>
          </div>
        </div>
      </div>

      <!-- 操作按钮组 -->
      <div class="flex items-center gap-2 self-end sm:self-center">
        <button
          class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors shadow-2xs"
          :class="copied
            ? 'bg-emerald-600 text-white'
            : 'bg-blue-600 hover:bg-blue-500 text-white'"
          @click="copyCode"
        >
          <UiIcon :name="copied ? 'check' : 'copy'" size="13" />
          {{ copied ? '已复制' : '复制验证码' }}
        </button>

        <button
          class="flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:border-blue-500 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 transition-colors"
          title="保存到当前浏览器的本地保险库"
          @click="saveToVault"
        >
          <UiIcon name="plus" size="13" />存入本地
        </button>
      </div>
    </div>
  </div>
</template>
