<script setup>
// ⚡️ 快速在线验码器（Quick OTP Scratchpad）
// 零门槛即开即用：粘贴 Base32 密钥或 otpauth:// 链接，实时出码 + 倒计时 + 自动复制 + 历史记录 + 一键二维码
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { generateOtp } from '@shared/otp.js';
import { parseOtpauthUri, isOtpauthUri } from '@shared/otpauth.js';
import { normalizeBase32 } from '@shared/base32.js';
import UiIcon from './ui/UiIcon.vue';
import QrModal from './QrModal.vue';

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

// 临时算码历史记录（保留最近 5 条于 localStorage）
const history = ref([]);

function loadHistory() {
  try {
    const raw = localStorage.getItem('2fahub.quick_history');
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
    digits: entry.digits || 6,
    period: entry.period || 30,
    algorithm: entry.algorithm || 'SHA1',
    time: Date.now(),
  });
  history.value = list.slice(0, 5);
  localStorage.setItem('2fahub.quick_history', JSON.stringify(history.value));
}

function removeHistoryItem(secret) {
  history.value = history.value.filter((h) => h.secret !== secret);
  localStorage.setItem('2fahub.quick_history', JSON.stringify(history.value));
  emit('toast', '已移除该条历史记录');
}

function clearHistory() {
  history.value = [];
  localStorage.removeItem('2fahub.quick_history');
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

// URL Query 参数联动（支持 ?secret=... 或 ?otp=...）
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
    emit('toast', `已自动复制验证码 ${otpCode}`);
    setTimeout(() => (copied.value = false), 1800);
  } catch {}
}

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
    <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
      <div class="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
        <UiIcon name="sparkles" size="15" />
        <span>在线快速验码 (Quick OTP)</span>
        <span class="text-zinc-400 dark:text-zinc-500 font-normal hidden sm:inline">· 粘贴即出码，不存网络</span>
      </div>
      <div class="flex items-center gap-3 text-xs">
        <!-- 自动复制开关 -->
        <button
          class="flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          :title="autoCopy ? '已开启：识别有效密钥后自动复制验证码' : '已关闭自动复制'"
          @click="toggleAutoCopy"
        >
          <UiIcon :name="autoCopy ? 'check-circle' : 'circle-x'" size="13" :class="autoCopy ? 'text-emerald-500' : 'text-zinc-400'" />
          <span>自动复制</span>
        </button>

        <!-- 演示密钥 -->
        <button
          class="flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          title="填入标准 Base32 演示密钥体验即时出码"
          @click="fillDemo"
        >
          <UiIcon name="key" size="13" />
          <span>演示密钥</span>
        </button>

        <!-- 粘贴剪贴板 / 清空 -->
        <button v-if="!input" class="flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors" @click="pasteFromClipboard">
          <UiIcon name="copy" size="13" />粘贴剪贴板
        </button>
        <button v-else class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors" @click="input = ''">
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
        class="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3.5 py-2.5 text-sm font-mono outline-none focus:border-blue-500 dark:focus:border-blue-500 transition-colors shadow-xs placeholder:font-sans placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
        @focus="$event.target.select()"
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
            <span class="font-mono text-2xl font-bold tracking-wider text-zinc-900 dark:text-zinc-100 select-all cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors" @click="copyCode">
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
      <div class="flex items-center gap-2 self-end sm:self-center flex-wrap">
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
          title="生成二维码以便手机验证器扫码导入"
          @click="showQr = true"
        >
          <UiIcon name="qr-code" size="13" />二维码
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

    <!-- 最近算码记录（临时便签历史） -->
    <div v-if="history.length > 0" class="mt-3.5 pt-3 border-t border-zinc-200/60 dark:border-zinc-800/60">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
          <UiIcon name="history" size="12" />
          <span>最近算码记录 ({{ history.length }})</span>
        </div>
        <button class="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors" @click="clearHistory">
          清空历史
        </button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <div
          v-for="item in history"
          :key="item.secret"
          class="group flex items-center justify-between gap-2 rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/50 dark:bg-zinc-900/50 p-2 text-xs hover:border-blue-500/40 hover:bg-white dark:hover:bg-zinc-900 transition-colors"
        >
          <button
            class="flex-1 text-left min-w-0"
            title="点击载入此密钥"
            @click="fillHistory(item)"
          >
            <div class="font-medium text-zinc-800 dark:text-zinc-200 truncate">
              {{ item.issuer || item.label || '临时验码' }}
            </div>
            <div class="font-mono text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
              {{ item.secret.slice(0, 4) }}••••{{ item.secret.slice(-4) }}
            </div>
          </button>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              class="p-1 rounded text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="载入"
              @click="fillHistory(item)"
            >
              <UiIcon name="sparkles" size="12" />
            </button>
            <button
              class="p-1 rounded text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="删除此条"
              @click="removeHistoryItem(item.secret)"
            >
              <UiIcon name="x" size="12" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 二维码模态弹窗 -->
    <QrModal
      v-if="showQr && parsedEntry"
      :entry="parsedEntry"
      @close="showQr = false"
      @toast="emit('toast', $event)"
    />
  </div>
</template>
