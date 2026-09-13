<script setup>
import { ref, computed, watch } from 'vue';
import QRCode from 'qrcode';
import { buildOtpauthUri } from '@shared/otpauth.js';
import UiIcon from './ui/UiIcon.vue';

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
      width: 240,
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
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs" @click.self="emit('close')">
    <div class="w-full max-w-sm rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-xl text-center">
      <!-- 头部 -->
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <UiIcon name="qr-code" size="16" class="text-blue-600 dark:text-blue-400" />
          <span>2FA 导入二维码</span>
        </div>
        <button class="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-md" @click="emit('close')">
          <UiIcon name="x" size="16" />
        </button>
      </div>

      <!-- 二维码图像卡片 -->
      <div class="inline-flex items-center justify-center p-3 rounded-xl bg-white border border-zinc-200 dark:border-zinc-700 shadow-xs mx-auto mb-3">
        <img v-if="qrUrl" :src="qrUrl" alt="2FA QR Code" class="w-52 h-52 select-none" />
        <div v-else class="w-52 h-52 flex items-center justify-center text-zinc-400">
          <UiIcon name="loader" size="24" class="animate-spin" />
        </div>
      </div>

      <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-4 leading-relaxed">
        请使用手机 <b>Google Authenticator</b>、<b>微软验证器</b> 或 <b>微信 2FA</b> 扫描上方二维码添加。
      </p>

      <!-- 密钥明文与复制 -->
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-2.5 text-left mb-4">
        <div class="text-[11px] text-zinc-400 dark:text-zinc-500 mb-1">Base32 密钥</div>
        <div class="font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200 break-all select-all">
          {{ entry.secret }}
        </div>
      </div>

      <!-- 底部动作栏 -->
      <div class="flex items-center gap-2">
        <button
          class="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:border-blue-500 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 transition-colors"
          @click="copyUri"
        >
          <UiIcon :name="copied ? 'check' : 'copy'" size="13" />
          {{ copied ? '已复制 URI' : '复制 otpauth://' }}
        </button>
        <button
          class="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 text-xs transition-colors"
          @click="emit('close')"
        >
          完成
        </button>
      </div>
    </div>
  </div>
</template>
