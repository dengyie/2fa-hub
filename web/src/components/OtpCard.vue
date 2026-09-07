<script setup>
// 单个条目卡片：实时出码、倒计时、点击复制、HOTP 出码
import { ref, computed, watch } from 'vue';
import { generateOtp } from '@shared/otp.js';
import UiIcon from './ui/UiIcon.vue';

const props = defineProps({
  entry: { type: Object, required: true },
  now: { type: Number, required: true },
  // 出码即推进计数器（HOTP）：async (entry) => void
  onHotpUse: { type: Function, default: null },
});
const emit = defineEmits(['edit', 'delete', 'move', 'toast']);

const code = ref('······');
const remaining = ref(null);
const nextCode = ref('');
const flash = ref(false);

let lastKey = '';
watch(
  () => [props.now, props.entry.secret, props.entry.counter, props.entry.period, props.entry.algorithm, props.entry.digits],
  async () => {
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

const progress = computed(() =>
  remaining.value == null ? 100 : Math.max(0, Math.round((remaining.value / (props.entry.period || 30)) * 100)),
);

async function copy() {
  await navigator.clipboard.writeText(code.value);
  flash.value = true;
  setTimeout(() => (flash.value = false), 600);
  emit('toast', `已复制 ${code.value}`);
  if (props.entry.type === 'hotp' && props.onHotpUse) props.onHotpUse(props.entry);
}

function initials() {
  return (props.entry.issuer || props.entry.label || '?').trim().slice(0, 2);
}
</script>

<template>
  <div class="group flex items-center gap-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3.5 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
    <div class="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center font-bold text-sm uppercase bg-blue-600/10 text-blue-600 dark:text-blue-400">
      {{ initials() }}
    </div>
    <div class="flex-1 min-w-0">
      <div class="text-xs text-zinc-500 dark:text-zinc-400 truncate">
        {{ entry.issuer || '未命名服务' }}<template v-if="entry.type === 'hotp'"> · HOTP</template>
      </div>
      <div class="text-[15px] font-semibold truncate">{{ entry.label || entry.issuer || '(无标签)' }}</div>
    </div>
    <div class="text-right shrink-0">
      <button class="otp-font text-2xl font-semibold tracking-widest transition-colors hover:text-blue-600 dark:hover:text-blue-400"
              :class="flash ? 'text-emerald-600 dark:text-emerald-400' : ''"
              title="点击复制" @click="copy">
        <span class="inline-flex gap-2">
          <span>{{ code.slice(0, 3) }}</span><span>{{ code.slice(3) }}</span>
        </span>
      </button>
      <div class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5" v-if="entry.type === 'totp'">{{ remaining }}s 后刷新</div>
      <div class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5" v-else>counter {{ entry.counter }} · 下一码 {{ nextCode }}</div>
      <div class="h-[3px] w-[72px] ml-auto mt-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden" v-if="entry.type === 'totp'">
        <div class="h-full rounded-full transition-all duration-1000 ease-linear"
             :class="progress < 25 ? 'bg-red-500' : 'bg-blue-500'"
             :style="{ width: progress + '%' }"></div>
      </div>
    </div>
    <div class="flex flex-col sm:flex-row gap-0.5 shrink-0 sm:opacity-60 sm:group-hover:opacity-100 transition-opacity">
      <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="上移" @click="emit('move', -1)"><UiIcon name="arrow-up" size="15" /></button>
      <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="下移" @click="emit('move', 1)"><UiIcon name="arrow-down" size="15" /></button>
      <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="复制" @click="copy"><UiIcon name="copy" size="15" /></button>
      <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="编辑" @click="emit('edit', entry)"><UiIcon name="pencil" size="15" /></button>
      <button class="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors" title="删除" @click="emit('delete', entry)"><UiIcon name="trash" size="15" /></button>
    </div>
  </div>
</template>
