<script setup>
import { ref, computed, watch } from 'vue';
import QRCode from 'qrcode';
import { buildOtpauthUri } from '@shared/otpauth.js';
import UiIcon from './ui/UiIcon.vue';
import LiquidGlass from './ui/LiquidGlass.vue';

const props = defineProps({
  entry: { type: Object, required: true },
});
const emit = defineEmits(['close', 'toast']);

const qrUrl = ref('');
const copied = ref(false);

const uri = computed(() => {
  if (!props.entry) return '';
  return buildOtpauthUri(props.entry);
});

async function generate() {
  if (!uri.value) return;
  try {
    qrUrl.value = await QRCode.toDataURL(uri.value, {
      width: 260,
      margin: 1.5,
      color: {
        dark: '#18181b',
        light: '#ffffff',
      },
    });
  } catch (err) {
    console.error('Failed to generate QR code', err);
  }
}

watch(() => props.entry, generate, { immediate: true });

async function copyUri() {
  try {
    if (!navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(uri.value);
    copied.value = true;
    emit('toast', '已复制 otpauth:// 链接');
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    emit('toast', '复制失败，请手动选取', true);
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-md overflow-y-auto" @click.self="emit('close')">
    <LiquidGlass
      variant="modal"
      intensity="thick"
      :interactive="false"
      className="w-full max-w-md mx-auto my-auto p-6 sm:p-7 shadow-2xl border border-white/70 dark:border-white/12 text-center"
    >
      <!-- 头部 -->
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2.5 text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100">
          <div class="w-8 h-8 rounded-xl bg-blue-600/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <UiIcon name="qr-code" size="18" />
          </div>
          <span>2FA 导入二维码</span>
        </div>
        <button
          class="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-xl hover:bg-white/40 dark:hover:bg-white/10 transition-colors"
          @click="emit('close')"
        >
          <UiIcon name="x" size="16" />
        </button>
      </div>

      <!-- 二维码图像卡片 (带有高光与微阴影) -->
      <div class="inline-flex items-center justify-center p-3.5 sm:p-4 rounded-3xl bg-white border border-white/80 dark:border-white/20 shadow-lg mx-auto mb-4">
        <img v-if="qrUrl" :src="qrUrl" alt="2FA QR Code" class="w-56 h-56 sm:w-60 sm:h-60 select-none rounded-xl" />
        <div v-else class="w-56 h-56 sm:w-60 sm:h-60 flex items-center justify-center text-zinc-400">
          <UiIcon name="loader" size="28" class="animate-spin text-blue-500" />
        </div>
      </div>

      <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-4 leading-relaxed">
        使用手机 <b>Google Authenticator</b>、<b>微软验证器</b> 或 <b>微信 2FA</b> 扫描上方二维码添加。
      </p>

      <!-- 密钥明文与复制 -->
      <div class="rounded-2xl border border-white/60 dark:border-white/10 bg-white/50 dark:bg-zinc-950/40 backdrop-blur-sm p-3 text-left mb-4 shadow-2xs">
        <div class="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mb-1">Base32 密钥</div>
        <div class="font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200 break-all select-all">
          {{ entry.secret }}
        </div>
      </div>

      <!-- 底部动作栏 -->
      <div class="flex items-center gap-2.5">
        <button
          class="glass-btn flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold"
          @click="copyUri"
        >
          <UiIcon :name="copied ? 'check' : 'copy'" size="13" />
          {{ copied ? '已复制 URI' : '复制 otpauth://' }}
        </button>
        <button
          class="glass-btn-primary flex-1 py-2.5 text-xs font-semibold"
          @click="emit('close')"
        >
          完成
        </button>
      </div>
    </LiquidGlass>
  </div>
</template>
