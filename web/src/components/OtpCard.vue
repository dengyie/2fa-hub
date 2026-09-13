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
const emit = defineEmits(['edit', 'delete', 'move', 'toast', 'qr']);

const code = ref('······');
const remaining = ref(null);
const nextCode = ref('');
const flash = ref(false);

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

const progress = computed(() =>
  remaining.value == null ? 100 : Math.max(0, Math.round((remaining.value / (props.entry.period || 30)) * 100)),
);

async function copy() {
  try {
    await navigator.clipboard.writeText(code.value);
  } catch {
    emit('toast', '复制失败（浏览器限制，请手动选择复制）', true);
    return;
  }
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
  <div class="group flex flex-col justify-between rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 sm:p-5 transition-all hover:border-blue-500/40 hover:shadow-md dark:hover:border-blue-500/30">
    <!-- 密文损坏的条目：显式标记，只能删除（不能出码/编辑） -->
    <template v-if="entry.decrypt_error">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center bg-red-500/10 text-red-600 dark:text-red-400">
            <UiIcon name="circle-x" size="20" />
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{{ entry.issuer || entry.label || '(未知条目)' }}</div>
            <div class="text-xs text-red-600 dark:text-red-400 mt-0.5">无法解密（数据损坏或密钥变更），建议删除后重新添加</div>
          </div>
        </div>
        <button class="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors" title="删除" @click="emit('delete', entry)">
          <UiIcon name="trash" size="15" />
        </button>
      </div>
    </template>

    <template v-else>
      <!-- 头部：图标 + 账户服务名 + 快捷工具栏 -->
      <div class="flex items-start justify-between gap-2.5 mb-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-xl flex items-center justify-center font-bold text-sm uppercase bg-blue-600/10 text-blue-600 dark:text-blue-400 select-none">
            {{ initials() }}
          </div>
          <div class="min-w-0">
            <div class="text-xs text-zinc-500 dark:text-zinc-400 truncate flex items-center gap-1.5">
              <span class="truncate font-medium">{{ entry.issuer || '未命名服务' }}</span>
              <span v-if="entry.type === 'hotp'" class="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold">HOTP</span>
            </div>
            <div class="text-sm sm:text-base font-semibold truncate text-zinc-900 dark:text-zinc-100 mt-0.5" :title="entry.label || entry.issuer">
              {{ entry.label || entry.issuer || '(无标签)' }}
            </div>
          </div>
        </div>

        <!-- 操作按钮（移动/扫码/编辑/删除） -->
        <div class="flex items-center gap-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
          <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="上移" @click="emit('move', -1)"><UiIcon name="arrow-up" size="14" /></button>
          <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="下移" @click="emit('move', 1)"><UiIcon name="arrow-down" size="14" /></button>
          <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="二维码" @click="emit('qr', entry)"><UiIcon name="qr-code" size="14" /></button>
          <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="编辑" @click="emit('edit', entry)"><UiIcon name="pencil" size="14" /></button>
          <button class="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors" title="删除" @click="emit('delete', entry)"><UiIcon name="trash" size="14" /></button>
        </div>
      </div>

      <!-- 底部：大号验证码 + 倒计时进度条 + 复制按钮 -->
      <div class="pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-3">
        <div>
          <button class="otp-font text-2xl sm:text-3xl font-bold tracking-widest transition-colors hover:text-blue-600 dark:hover:text-blue-400 select-all text-left"
                  :class="flash ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-900 dark:text-zinc-100'"
                  title="点击复制" @click="copy">
            <span class="inline-flex gap-2">
              <span>{{ code.slice(0, Math.ceil(code.length / 2)) }}</span><span>{{ code.slice(Math.ceil(code.length / 2)) }}</span>
            </span>
          </button>
          <div class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 flex items-center gap-2" v-if="entry.type === 'totp'">
            <span>{{ remaining }}s 后刷新</span>
            <div class="h-1.5 w-16 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden inline-block">
              <div class="h-full rounded-full transition-all duration-1000 ease-linear"
                   :class="progress < 25 ? 'bg-red-500' : 'bg-blue-500'"
                   :style="{ width: progress + '%' }"></div>
            </div>
          </div>
          <div class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1" v-else>counter {{ entry.counter }} · 下一码 {{ nextCode }}</div>
        </div>

        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 bg-zinc-50 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 transition-colors shadow-2xs"
          @click="copy"
        >
          <UiIcon :name="flash ? 'check' : 'copy'" size="13" :class="flash ? 'text-emerald-500' : ''" />
          <span>{{ flash ? '已复制' : '复制' }}</span>
        </button>
      </div>
    </template>
  </div>
</template>
