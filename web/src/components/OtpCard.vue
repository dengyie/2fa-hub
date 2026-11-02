<script setup>
// 单个条目卡片：真实光学液体玻璃、4 阶段色相演进倒计时、品牌微质感识别与极速出码
import { ref, computed, watch } from 'vue';
import { generateOtp } from '@shared/otp.js';
import UiIcon from './ui/UiIcon.vue';
import LiquidGlass from './ui/LiquidGlass.vue';
import { getBrandInfo } from '../lib/brandHelper.js';

const props = defineProps({
  entry: { type: Object, required: true },
  now: { type: Number, required: true },
  // 出码即推进计数器（HOTP）：async (entry) => void
  onHotpUse: { type: Function, default: null },
});
const emit = defineEmits(['edit', 'delete', 'move', 'toast', 'qr']);

const code = ref('······');
const remaining = ref(null);
const nextCode = ref('');
const flash = ref(false);
let flashTimer = null;

let lastKey = '';
watch(
  () => [props.now, props.entry.secret, props.entry.counter, props.entry.period, props.entry.algorithm, props.entry.digits],
  async () => {
    // 解密失败的条目（服务端标记）不出码，仅保留删除入口
    if (props.entry.decrypt_error) return;
    const period = props.entry.period || 30;
    // TOTP 的缓存 key 必须包含当前时间桶，否则换周期后验证码不会刷新
    const bucket = props.entry.type === 'totp'
      ? Math.floor(props.now / 1000 / period)
      : props.entry.counter;
    const key = `${props.entry.secret}|${props.entry.type}|${bucket}|${period}|${props.entry.algorithm}|${props.entry.digits}`;
    if (props.entry.type === 'totp' && key === lastKey) {
      remaining.value = period - Math.floor(props.now / 1000) % period;
      return; // 同一周期内只需更新倒计时
    }
    if (props.entry.type === 'hotp' && key === lastKey) return;
    lastKey = key;
    const r = await generateOtp(props.entry, props.now);
    code.value = r.code;
    remaining.value = r.remaining;
    nextCode.value = r.nextCode || '';
  },
  { immediate: true },
);

// 品牌与服务视觉信息
const brand = computed(() => getBrandInfo(props.entry.issuer, props.entry.label));

// 4 阶段动态倒计时色相演进系统（翠绿 -> 天蓝 -> 暖琥珀 -> 急促玫瑰红）
const timerState = computed(() => {
  if (props.entry.type !== 'totp') return null;
  const rem = remaining.value ?? 30;
  const period = props.entry.period || 30;
  const pct = Math.max(0, Math.min(100, Math.round((rem / period) * 100)));

  if (rem <= 5) {
    return {
      stage: 'urgent',
      color: '#f43f5e', // rose-500
      glow: 'rgba(244, 63, 94, 0.65)',
      badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 animate-pulse',
      percent: pct,
      isUrgent: true,
    };
  }
  if (rem <= 10) {
    return {
      stage: 'warning',
      color: '#f59e0b', // amber-500
      glow: 'rgba(245, 158, 11, 0.55)',
      badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
      percent: pct,
      isUrgent: false,
    };
  }
  if (rem <= 20) {
    return {
      stage: 'normal',
      color: '#3b82f6', // blue-500
      glow: 'rgba(59, 130, 246, 0.45)',
      badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
      percent: pct,
      isUrgent: false,
    };
  }
  return {
    stage: 'fresh',
    color: '#10b981', // emerald-500
    glow: 'rgba(16, 185, 129, 0.45)',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    percent: pct,
    isUrgent: false,
  };
});

// 格式化输出：例如 6 位显示为 "382 193"，8 位显示为 "3821 8193"
const formattedCode = computed(() => {
  if (!code.value || code.value.includes('·')) return code.value;
  const half = Math.ceil(code.value.length / 2);
  return {
    first: code.value.slice(0, half),
    second: code.value.slice(half),
  };
});

async function copy() {
  if (!code.value || code.value.includes('·') || code.value === 'Error') return;
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
  // 触感震动反馈（移动端支持时短促振动 20ms）
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(20); } catch {}
  }
  // 清除任何选区并防止文本高亮
  if (typeof window !== 'undefined' && window.getSelection) {
    try {
      window.getSelection()?.removeAllRanges();
    } catch {}
  }
  flash.value = true;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flash.value = false), 1200);
  // 注意：不再调用 emit('toast', `已复制 ${code.value}`)，避免遮挡与明文数字外显打扰
  if (props.entry.type === 'hotp' && props.onHotpUse) props.onHotpUse(props.entry);
}

defineExpose({ copy, code, entry: props.entry });
</script>

<template>
  <LiquidGlass
    variant="none"
    intensity="regular"
    :interactive="true"
    :enableTilt="true"
    :maxTilt="3"
    className="group relative flex flex-col justify-between rounded-2xl sm:rounded-3xl p-4 sm:p-5 h-full transition-all duration-300 hover:border-blue-500/40 dark:hover:border-blue-400/30 hover:shadow-[0_16px_40px_rgba(0,0,0,0.08),inset_0_1px_1px_rgba(255,255,255,0.9)] dark:hover:shadow-[0_20px_50px_rgba(0,0,0,0.45),inset_0_1px_1px_rgba(255,255,255,0.22)]"
  >
    <!-- 密文损坏的条目：显式标记，只能删除 -->
    <template v-if="entry.decrypt_error">
      <div class="flex items-start justify-between gap-3 my-auto">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 shadow-inner">
            <UiIcon name="circle-x" size="22" />
          </div>
          <div class="min-w-0">
            <div class="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">{{ entry.issuer || entry.label || '(损坏条目)' }}</div>
            <div class="text-xs text-red-600 dark:text-red-400 mt-1 leading-normal">数据损坏或主密钥不匹配，无法解密</div>
          </div>
        </div>
        <button
          class="p-2 rounded-xl text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          title="删除损坏条目"
          @click="emit('delete', entry)"
        >
          <UiIcon name="trash" size="16" />
        </button>
      </div>
    </template>

    <template v-else>
      <!-- 头部：品牌徽标 + 服务名称与账户 + 悬浮胶囊工具栏 -->
      <div class="flex items-start justify-between gap-2.5 mb-3.5">
        <div class="flex items-center gap-3 min-w-0">
          <!-- 识别品牌的高清微质感徽标 -->
          <div
            :class="[
              'w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center font-bold text-sm tracking-tight border bg-gradient-to-br transition-transform duration-300 group-hover:scale-105 select-none',
              brand.gradient
            ]"
          >
            {{ brand.short }}
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <div class="text-sm sm:text-base font-extrabold truncate text-zinc-900 dark:text-zinc-100" :title="entry.issuer || '未命名服务'">
                {{ entry.issuer || '未命名服务' }}
              </div>
              <span v-if="entry.type === 'hotp'" class="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20">HOTP</span>
            </div>
            <div class="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5 font-medium" :title="entry.label || entry.issuer">
              {{ entry.label || '(默认主账户)' }}
            </div>
          </div>
        </div>

        <!-- 悬浮微型工具胶囊栏 -->
        <div class="flex items-center gap-0.5 p-1 rounded-xl bg-black/5 dark:bg-white/5 border border-white/60 dark:border-white/10 backdrop-blur-sm opacity-80 group-hover:opacity-100 transition-all shadow-2xs">
          <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-white/80 dark:hover:bg-white/10 transition-colors" title="上移" @click="emit('move', -1)">
            <UiIcon name="arrow-up" size="14" />
          </button>
          <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-white/80 dark:hover:bg-white/10 transition-colors" title="下移" @click="emit('move', 1)">
            <UiIcon name="arrow-down" size="14" />
          </button>
          <button class="p-1.5 rounded-lg text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white/80 dark:hover:bg-white/10 transition-colors" title="导出二维码" @click="emit('qr', entry)">
            <UiIcon name="qr-code" size="14" />
          </button>
          <button class="p-1.5 rounded-lg text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white/80 dark:hover:bg-white/10 transition-colors" title="编辑条目" @click="emit('edit', entry)">
            <UiIcon name="pencil" size="14" />
          </button>
          <button class="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors" title="删除条目" @click="emit('delete', entry)">
            <UiIcon name="trash" size="14" />
          </button>
        </div>
      </div>

      <!-- 核心数字展示区（交互点击整块复制，禁止原生选中文本） -->
      <div
        class="my-1.5 p-3 sm:p-3.5 rounded-2xl border transition-all duration-300 cursor-pointer select-none group/code flex items-center justify-between shadow-2xs active:scale-[0.98]"
        :class="flash
          ? 'bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/50 ring-2 ring-emerald-500/25 shadow-[0_0_20px_rgba(16,185,129,0.22)]'
          : 'bg-white/40 dark:bg-white/5 border-white/60 dark:border-white/10 hover:border-blue-500/40 dark:hover:border-blue-400/30 hover:bg-white/60 dark:hover:bg-white/10'"
        @click="copy"
        @mousedown.prevent
        title="点击直接复制验证码到剪贴板"
      >
        <div class="min-w-0 select-none">
          <div
            v-if="typeof formattedCode === 'object'"
            class="otp-font text-2xl sm:text-[32px] font-extrabold tracking-[0.2em] transition-all duration-200 leading-none flex items-center gap-2.5 select-none"
            :class="flash ? 'text-emerald-600 dark:text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.35)]' : 'text-zinc-900 dark:text-zinc-100 group-hover/code:text-blue-600 dark:group-hover/code:text-blue-400'"
          >
            <span class="select-none">{{ formattedCode.first }}</span>
            <span class="opacity-30 font-light select-none">·</span>
            <span class="select-none">{{ formattedCode.second }}</span>
          </div>
          <div
            v-else
            class="otp-font text-2xl sm:text-[32px] font-extrabold tracking-[0.2em] transition-all duration-200 leading-none select-none"
            :class="flash ? 'text-emerald-600 dark:text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.35)]' : 'text-zinc-900 dark:text-zinc-100 group-hover/code:text-blue-600 dark:group-hover/code:text-blue-400'"
          >
            {{ code }}
          </div>
        </div>

        <!-- 触感复制微状态胶囊 -->
        <div
          class="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all duration-200"
          :class="flash
            ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
            : 'bg-white/70 dark:bg-zinc-800/80 border-white/80 dark:border-white/10 text-zinc-600 dark:text-zinc-300 group-hover/code:border-blue-500/40 group-hover/code:text-blue-600 dark:group-hover/code:text-blue-400'"
        >
          <UiIcon :name="flash ? 'check' : 'copy'" size="13" />
          <span>{{ flash ? '已复制' : '复制' }}</span>
        </div>
      </div>

      <!-- 底部：4 阶段色相演进倒计时仪表盘 / HOTP 计数器推进 -->
      <div class="mt-2 pt-2.5 border-t border-white/50 dark:border-white/5 flex items-center justify-between text-xs">
        <!-- TOTP 倒计时展示：极简高效（动态微光环形规 + 唯一秒数指示） -->
        <div v-if="entry.type === 'totp' && timerState" class="flex items-center">
          <div
            class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border transition-all duration-500"
            :class="timerState.badgeClass"
          >
            <!-- 环形微型仪表盘 -->
            <div class="relative w-3.5 h-3.5 shrink-0 flex items-center justify-center">
              <svg class="w-full h-full -rotate-90" viewBox="0 0 28 28">
                <circle
                  cx="14" cy="14" r="11"
                  stroke-width="3"
                  class="text-zinc-200/60 dark:text-zinc-700/60 stroke-current fill-none"
                />
                <circle
                  cx="14" cy="14" r="11"
                  stroke-width="3"
                  stroke-linecap="round"
                  class="fill-none transition-[stroke-dashoffset] duration-1000 ease-linear"
                  :style="{
                    stroke: timerState.color,
                    strokeDasharray: '69.115',
                    strokeDashoffset: (69.115 * (1 - timerState.percent / 100)),
                    filter: 'drop-shadow(0 0 2px ' + timerState.glow + ')'
                  }"
                />
              </svg>
            </div>
            <span class="tabular-nums tracking-tight">{{ remaining }}s</span>
          </div>
        </div>

        <!-- HOTP 计数器展示 -->
        <div v-else class="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
          <span class="px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            #{{ entry.counter }}
          </span>
          <span class="text-[11px]">下一码: {{ nextCode || '··' }}</span>
        </div>

        <!-- 算法与位数元数据胶囊 -->
        <div class="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
          {{ entry.algorithm }} · {{ entry.digits }}位
        </div>
      </div>

      <!-- 底部卡片一体化发光液态光轨（全底缘 4 阶段色相演进） -->
      <div v-if="entry.type === 'totp' && timerState" class="absolute bottom-0 left-0 right-0 h-[3px] bg-black/5 dark:bg-white/5 overflow-hidden rounded-b-[inherit]">
        <div
          class="h-full transition-[width] duration-1000 ease-linear"
          :style="{
            width: timerState.percent + '%',
            backgroundColor: timerState.color,
            boxShadow: '0 0 10px ' + timerState.glow,
          }"
          :class="timerState.isUrgent ? 'animate-pulse' : ''"
        />
      </div>
    </template>
  </LiquidGlass>
</template>
