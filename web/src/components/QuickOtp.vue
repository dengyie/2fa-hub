<script setup>
// ⚡️ 快速在线验码器（Quick OTP Scratchpad）
// 零门槛即开即用：粘贴 Base32 密钥或 otpauth:// 链接，实时出码 + 4 阶段动态色相倒计时 + 自动复制 + 历史记录 + 一键二维码
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { generateOtp } from '@shared/otp.js';
import { parseOtpauthUri, isOtpauthUri } from '@shared/otpauth.js';
import { normalizeBase32 } from '@shared/base32.js';
import UiIcon from './ui/UiIcon.vue';
import QrModal from './QrModal.vue';
import LiquidGlass from './ui/LiquidGlass.vue';
import { getBrandInfo } from '../lib/brandHelper.js';

const props = defineProps({
  now: { type: Number, required: true },
});

const emit = defineEmits(['save-entry', 'toast']);

const route = useRoute();
const input = ref('');
const error = ref('');
const parsedEntry = ref(null);
const code = ref('······');
const remaining = ref(null);
const copied = ref(false);
const showQr = ref(false);

// 演示密钥（与业界一致的高兼容性 Base32 演示种子）
const DEMO_SECRET = '7J64V3P3E77J3LKNUGSZ5QANTLRLTKVL';

// 自动复制开关（默认开启）
const autoCopy = ref(localStorage.getItem('2fahub.quick_autocopy') !== 'false');

function toggleAutoCopy() {
  autoCopy.value = !autoCopy.value;
  localStorage.setItem('2fahub.quick_autocopy', String(autoCopy.value));
  emit('toast', autoCopy.value ? '已开启自动复制验证码' : '已关闭自动复制');
}

// 临时算码历史记录（保留最近 5 条于 sessionStorage）
const history = ref([]);

function loadHistory() {
  try {
    const raw = sessionStorage.getItem('2fahub.quick_history');
    if (raw) history.value = JSON.parse(raw);
  } catch {
    history.value = [];
  }
}

function pushHistory(entry) {
  if (!entry?.secret) return;
  const list = history.value.filter((h) => h.secret !== entry.secret);
  list.unshift({
    secret: entry.secret,
    issuer: entry.issuer || '',
    label: entry.label || '',
    type: entry.type || 'totp',
    time: Date.now(),
  });
  history.value = list.slice(0, 5);
  sessionStorage.setItem('2fahub.quick_history', JSON.stringify(history.value));
}

function removeHistoryItem(secret) {
  history.value = history.value.filter((h) => h.secret !== secret);
  sessionStorage.setItem('2fahub.quick_history', JSON.stringify(history.value));
  emit('toast', '已移除该条历史记录');
}

function clearHistory() {
  history.value = [];
  sessionStorage.removeItem('2fahub.quick_history');
  emit('toast', '已清空最近验码记录');
}

function fillHistory(item) {
  input.value = item.secret;
  emit('toast', '已填入密钥并计算');
}

// 填充演示密钥
function fillDemo() {
  input.value = DEMO_SECRET;
  emit('toast', '已填入演示密钥');
}

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
      pushHistory(e);
    } else {
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
      pushHistory(parsedEntry.value);
    }
  } catch (err) {
    parsedEntry.value = null;
    error.value = err.message && (err.message.includes('过短') || err.message.includes('Base32') || err.message.includes('otpauth'))
      ? err.message
      : '无效的 2FA 密钥或链接（需为 Base32 或 otpauth:// 格式）';
  }
}

watch(input, (val) => parseInput(val));

// URL Query 参数联动
function checkRouteQuery() {
  const q = route?.query?.secret || route?.query?.otp;
  if (q && typeof q === 'string') {
    input.value = q.trim();
  }
}

onMounted(() => {
  loadHistory();
  checkRouteQuery();
});

watch(() => route?.query, checkRouteQuery);

// 实时计算 OTP 与自动复制
let lastKey = '';
let lastCopiedSecret = '';

watch(
  () => [props.now, parsedEntry.value],
  async () => {
    if (!parsedEntry.value) {
      code.value = '······';
      remaining.value = null;
      lastKey = '';
      lastCopiedSecret = '';
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

      // 识别到新密钥生成成功时触发自动复制
      if (autoCopy.value && r.code && r.code !== 'Error' && lastCopiedSecret !== e.secret) {
        lastCopiedSecret = e.secret;
        await autoCopyCode(r.code);
      }
    } catch (err) {
      code.value = 'Error';
      error.value = `出码失败：${err.message}`;
    }
  },
  { immediate: true },
);

async function autoCopyCode(otpCode) {
  try {
    if (!navigator?.clipboard?.writeText) return;
    await navigator.clipboard.writeText(otpCode);
    copied.value = true;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(20); } catch {}
    }
    // 静默写入剪贴板，由界面高亮与徽章承接，避免底部弹窗泄露明文
    setTimeout(() => (copied.value = false), 1800);
  } catch {}
}

const brand = computed(() => {
  if (!parsedEntry.value) return null;
  return getBrandInfo(parsedEntry.value.issuer, parsedEntry.value.label);
});

// 4 阶段动态倒计时色相演进系统
const timerState = computed(() => {
  if (!parsedEntry.value || remaining.value == null) return null;
  const rem = remaining.value;
  const period = parsedEntry.value.period || 30;
  const pct = Math.max(0, Math.min(100, Math.round((rem / period) * 100)));

  if (rem <= 5) {
    return {
      stage: 'urgent',
      color: '#f43f5e',
      glow: 'rgba(244, 63, 94, 0.65)',
      badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 animate-pulse',
      percent: pct,
      isUrgent: true,
    };
  }
  if (rem <= 10) {
    return {
      stage: 'warning',
      color: '#f59e0b',
      glow: 'rgba(245, 158, 11, 0.55)',
      badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
      percent: pct,
      isUrgent: false,
    };
  }
  if (rem <= 20) {
    return {
      stage: 'normal',
      color: '#3b82f6',
      glow: 'rgba(59, 130, 246, 0.45)',
      badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
      percent: pct,
      isUrgent: false,
    };
  }
  return {
    stage: 'fresh',
    color: '#10b981',
    glow: 'rgba(16, 185, 129, 0.45)',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    percent: pct,
    isUrgent: false,
  };
});

const formattedCode = computed(() => {
  const c = code.value || '';
  if (c.length === 6) {
    return { first: c.slice(0, 3), second: c.slice(3) };
  }
  if (c.length === 8) {
    return { first: c.slice(0, 4), second: c.slice(4) };
  }
  return { first: c, second: '' };
});

async function copyCode() {
  if (!code.value || code.value === '······' || code.value === 'Error') return;
  let copiedOk = false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(code.value);
      copiedOk = true;
    }
  } catch {}
  if (!copiedOk) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = code.value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      copiedOk = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch {}
  }
  if (!copiedOk) {
    emit('toast', '复制失败，请手动选取', true);
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(20); } catch {}
  }
  // 清除任何选区并防止文本高亮
  if (typeof window !== 'undefined' && window.getSelection) {
    try {
      window.getSelection()?.removeAllRanges();
    } catch {}
  }
  copied.value = true;
  // 原位绿色动效与按钮文字变为「已复制」，无需触发全屏 Toast 造成干扰
  setTimeout(() => (copied.value = false), 1800);
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
  <LiquidGlass
    variant="none"
    intensity="regular"
    className="relative overflow-hidden rounded-3xl p-5 sm:p-6 lg:p-7 border border-blue-500/30 dark:border-blue-400/20 bg-white/70 dark:bg-zinc-900/60 shadow-[0_12px_40px_rgba(37,99,235,0.07),inset_0_1px_1px_rgba(255,255,255,0.85)] dark:shadow-[0_16px_48px_rgba(0,0,0,0.45),inset_0_1px_1px_rgba(255,255,255,0.18)] transition-all"
  >
    <!-- 顶栏标题与快捷按钮 -->
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2.5">
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-xl bg-blue-600/15 flex items-center justify-center text-blue-600 dark:text-blue-400 border border-blue-500/25 shadow-2xs">
          <UiIcon name="sparkles" size="16" />
        </div>
        <div>
          <h2 class="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            在线即时验码
            <span class="text-xs font-normal text-zinc-400 dark:text-zinc-500 hidden sm:inline">· 离线计算，隐私不出本机</span>
          </h2>
        </div>
      </div>

      <div class="flex items-center gap-2 sm:gap-2.5 text-xs sm:text-sm">
        <!-- 自动复制开关 -->
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/60 dark:bg-white/5 border border-white/60 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shadow-2xs font-medium cursor-pointer"
          :title="autoCopy ? '已开启：识别有效密钥后自动复制验证码' : '已关闭自动复制'"
          @click="toggleAutoCopy"
        >
          <UiIcon :name="autoCopy ? 'check' : 'x'" size="13" :class="autoCopy ? 'text-emerald-500' : 'text-zinc-400'" />
          <span>自动复制</span>
        </button>

        <!-- 演示密钥 -->
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/60 dark:bg-white/5 border border-white/60 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shadow-2xs font-medium cursor-pointer"
          title="填入标准 Base32 演示密钥体验即时出码"
          @click="fillDemo"
        >
          <UiIcon name="key" size="13" />
          <span>演示密钥</span>
        </button>

        <!-- 粘贴剪贴板 / 清空 -->
        <button
          v-if="!input"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 border border-blue-500/25 hover:bg-blue-600/20 transition-colors font-semibold shadow-2xs cursor-pointer"
          @click="pasteFromClipboard"
        >
          <UiIcon name="copy" size="13" />粘贴剪贴板
        </button>
        <button
          v-else
          class="px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          @click="input = ''"
        >
          清空
        </button>
      </div>
    </div>

    <!-- 输入栏：聚焦自动选中 -->
    <div class="relative">
      <input
        v-model="input"
        type="text"
        placeholder="粘贴 2FA 密钥 (Base32，如 JBSWY3DPEHPK3PXP) 或 otpauth:// 链接..."
        class="glass-input w-full px-4 py-3 sm:py-3.5 text-sm sm:text-base font-mono placeholder:font-sans placeholder:text-zinc-400 dark:placeholder:text-zinc-500 rounded-2xl"
        @focus="$event.target.select()"
      />
      <button
        v-if="input"
        class="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-xl"
        @click="input = ''"
      >
        <UiIcon name="x" size="16" />
      </button>
    </div>

    <!-- 错误提示 -->
    <div v-if="error && input" class="flex items-center gap-2 text-xs sm:text-sm text-rose-600 dark:text-rose-400 mt-2.5 px-1 font-medium">
      <UiIcon name="circle-x" size="15" />
      <span>{{ error }}</span>
    </div>

    <!-- 成功算码结果卡片 -->
    <div
      v-if="parsedEntry && !error"
      class="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 rounded-2xl border border-white/70 dark:border-white/10 bg-white/75 dark:bg-white/5 backdrop-blur-xl p-4 sm:p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_8px_24px_rgba(0,0,0,0.04)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_12px_32px_rgba(0,0,0,0.35)]"
    >
      <div class="flex items-center gap-3.5 sm:gap-4.5">
        <!-- 4 阶段色相演进倒计时圆环 -->
        <div class="relative w-12 h-12 sm:w-14 sm:h-14 shrink-0 flex items-center justify-center">
          <svg class="w-full h-full -rotate-90" viewBox="0 0 36 36">
            <path
              class="text-zinc-200/80 dark:text-zinc-800"
              stroke-width="3"
              stroke="currentColor"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              v-if="timerState"
              stroke-dasharray="100, 100"
              :stroke-dashoffset="100 - timerState.percent"
              stroke-linecap="round"
              stroke-width="3.2"
              fill="none"
              class="transition-[stroke-dashoffset] duration-1000 ease-linear"
              :style="{
                stroke: timerState.color,
                filter: 'drop-shadow(0 0 4px ' + timerState.glow + ')'
              }"
              :class="timerState.isUrgent ? 'animate-pulse' : ''"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
          <span
            class="absolute font-mono text-xs sm:text-sm font-bold transition-colors duration-500"
            :style="{ color: timerState ? timerState.color : undefined }"
          >
            {{ remaining != null ? `${remaining}s` : 'HOTP' }}
          </span>
        </div>

        <!-- 验证码与元信息 -->
        <div>
          <div
            class="otp-font text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-[0.2em] select-none cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors leading-none flex items-center gap-2"
            :class="copied ? 'text-emerald-600 dark:text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.35)]' : 'text-zinc-900 dark:text-zinc-100'"
            @click="copyCode"
            @mousedown.prevent
            title="点击复制"
          >
            <span class="select-none">{{ formattedCode.first }}</span>
            <span v-if="formattedCode.second" class="opacity-30 font-light select-none">·</span>
            <span v-if="formattedCode.second" class="select-none">{{ formattedCode.second }}</span>
          </div>

          <div class="flex items-center gap-2 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-2">
            <span v-if="brand" :class="['px-2 py-0.5 rounded-lg text-xs font-bold border', brand.gradient]">
              {{ brand.brandName }}
            </span>
            <span v-if="parsedEntry.label && parsedEntry.issuer">·</span>
            <span v-if="parsedEntry.label" class="font-medium text-zinc-700 dark:text-zinc-300">{{ parsedEntry.label }}</span>
            <span class="text-zinc-400 dark:text-zinc-500 font-mono text-xs">({{ parsedEntry.algorithm }}, {{ parsedEntry.digits }}位)</span>
          </div>
        </div>
      </div>

      <!-- 操作按钮组 -->
      <div class="flex items-center gap-2.5 self-end sm:self-center flex-wrap">
        <button
          class="flex items-center gap-2 rounded-xl px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-bold transition-all duration-200 shadow-md active:scale-95 cursor-pointer"
          :class="copied
            ? 'bg-emerald-600 text-white shadow-[0_4px_16px_rgba(16,185,129,0.4)]'
            : 'glass-btn-primary'"
          @click="copyCode"
        >
          <UiIcon :name="copied ? 'check' : 'copy'" size="15" />
          {{ copied ? '已复制' : '复制验证码' }}
        </button>

        <button
          class="glass-btn flex items-center gap-1.5 px-3.5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold cursor-pointer"
          title="生成二维码以便手机验证器扫码导入"
          @click="showQr = true"
        >
          <UiIcon name="qr-code" size="14" />二维码
        </button>

        <button
          class="glass-btn flex items-center gap-1.5 px-3.5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold cursor-pointer"
          title="保存到当前浏览器的本地保险库"
          @click="saveToVault"
        >
          <UiIcon name="plus" size="14" />存入本地
        </button>
      </div>
    </div>

    <!-- 最近算码记录（临时便签历史） -->
    <div v-if="history.length > 0" class="mt-4 pt-3.5 border-t border-white/60 dark:border-white/10">
      <div class="flex items-center justify-between mb-2.5">
        <div class="flex items-center gap-1.5 text-xs font-bold text-zinc-500 dark:text-zinc-400">
          <UiIcon name="history" size="14" />
          <span>临时算码便签 ({{ history.length }})</span>
        </div>
        <button class="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors cursor-pointer" @click="clearHistory">
          清空便签
        </button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <div
          v-for="item in history"
          :key="item.secret"
          class="group flex items-center justify-between gap-2.5 rounded-2xl border border-white/50 dark:border-white/10 bg-white/50 dark:bg-white/5 backdrop-blur-sm p-2.5 text-xs hover:border-blue-500/40 hover:bg-white/80 dark:hover:bg-white/10 transition-all shadow-2xs"
        >
          <button
            class="flex-1 text-left min-w-0 cursor-pointer"
            title="点击载入此密钥"
            @click="fillHistory(item)"
          >
            <div class="font-bold text-zinc-800 dark:text-zinc-200 truncate">
              {{ item.issuer || item.label || '临时验码' }}
            </div>
            <div class="font-mono text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
              {{ item.secret.slice(0, 4) }}····{{ item.secret.slice(-4) }}
            </div>
          </button>
          <button
            class="p-1 text-zinc-300 hover:text-red-500 rounded-lg opacity-60 group-hover:opacity-100 transition-all cursor-pointer"
            title="删除此记录"
            @click.stop="removeHistoryItem(item.secret)"
          >
            <UiIcon name="x" size="13" />
          </button>
        </div>
      </div>
    </div>

    <!-- 弹窗：二维码查看器 -->
    <QrModal v-if="showQr && parsedEntry" :entry="parsedEntry" @close="showQr = false" @toast="emit('toast', $event)" />
  </LiquidGlass>
</template>
