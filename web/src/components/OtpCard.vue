<script setup>
// 单个条目卡片：实时出码、倒计时、点击复制、HOTP 出码
import { ref, computed, watch } from 'vue';
import { generateOtp } from '@shared/otp.js';

const props = defineProps({
  entry: { type: Object, required: true },
  now: { type: Number, required: true },
  // 出码即推进计数器（HOTP）：async (entry) => void
  onHotpUse: { type: Function, default: null },
});
const emit = defineEmits(['edit', 'delete', 'toast', 'move']);

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
  remaining.value == null ? 100 : Math.round((remaining.value / (props.entry.period || 30)) * 100),
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
  <div class="otp-card">
    <div class="otp-icon">{{ initials() }}</div>
    <div class="otp-meta">
      <div class="otp-issuer">{{ entry.issuer || '未命名服务' }}<template v-if="entry.type === 'hotp'"> · HOTP</template></div>
      <div class="otp-label">{{ entry.label || entry.issuer || '(无标签)' }}</div>
    </div>
    <div class="otp-code-row">
      <button class="otp-code" :class="{ flash }" title="点击复制" @click="copy">
        <span class="halves">
          <span>{{ code.slice(0, 3) }}</span><span>{{ code.slice(3) }}</span>
        </span>
      </button>
      <div class="otp-sub" v-if="entry.type === 'totp'">{{ remaining }}s 后刷新</div>
      <div class="otp-sub" v-else>counter {{ entry.counter }} · 下一码 {{ nextCode }}</div>
      <div class="progress" v-if="entry.type === 'totp'">
        <div :class="{ low: progress < 25 }" :style="{ width: progress + '%' }"></div>
      </div>
    </div>
    <div class="card-actions">
      <button class="iconbtn" title="上移" @click="emit('move', -1)">↑</button>
      <button class="iconbtn" title="下移" @click="emit('move', 1)">↓</button>
      <button class="iconbtn" title="编辑" @click="emit('edit', entry)">✎</button>
      <button class="iconbtn danger" title="删除" @click="emit('delete', entry)">✕</button>
    </div>
  </div>
</template>
