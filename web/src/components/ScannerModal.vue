<script setup>
// 摄像头/图片扫码：解码 otpauth:// 二维码
import { ref, onMounted, onBeforeUnmount } from 'vue';
import jsQR from 'jsqr';
import { decodeQRImage } from '../lib/decodeQR.js';
import UiIcon from './ui/UiIcon.vue';
import LiquidGlass from './ui/LiquidGlass.vue';

const emit = defineEmits(['decoded', 'cancel']);
const error = ref('');
const videoRef = ref(null);

let stream = null;
let raf = 0;
let canvasCtx = null;
let cancelled = false;   // getUserMedia 未 resolve 时卸载组件，之后必须放弃并释放流

onMounted(startCamera);
onBeforeUnmount(stop);

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }, audio: false,
    });
    if (cancelled) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      return;
    }
    videoRef.value.srcObject = stream;
    await videoRef.value.play();
    const canvas = document.createElement('canvas');
    canvasCtx = canvas.getContext('2d', { willReadFrequently: true });
    tick(canvas, videoRef.value);
  } catch (err) {
    if (cancelled) return;
    error.value = `无法打开摄像头（${err.name}）。可改用下方上传二维码图片。`;
  }
}

function tick(canvas, video) {
  const loop = () => {
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvasCtx.drawImage(video, 0, 0);
      const img = canvasCtx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (found?.data) {
        stop();
        emit('decoded', found.data);
        return;
      }
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

async function onFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  const raw = await decodeQRImage(img);
  if (raw) emit('decoded', raw);
  else error.value = '图片中未识别到二维码';
  URL.revokeObjectURL(img.src);
}

function stop() {
  cancelled = true;
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
}
</script>

<template>
  <div class="fixed inset-0 z-[60] bg-black/50 backdrop-blur-md flex items-start justify-center p-4 sm:p-6 overflow-y-auto" @click.self="emit('cancel'); stop()">
    <LiquidGlass
      variant="modal"
      intensity="thick"
      :interactive="false"
      className="w-full max-w-md mx-auto my-auto p-6 shadow-2xl border border-white/70 dark:border-white/12"
    >
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-blue-600/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <UiIcon name="scan" size="18" />
          </div>
          <h3 class="text-base font-bold text-zinc-900 dark:text-zinc-100 m-0">扫描二维码</h3>
        </div>
        <button
          class="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-white/40 dark:hover:bg-white/10 transition-colors"
          @click="emit('cancel'); stop()"
        >
          <UiIcon name="x" size="16" />
        </button>
      </div>

      <div class="rounded-2xl overflow-hidden bg-black border border-white/40 dark:border-white/10 relative shadow-inner">
        <video ref="videoRef" muted playsinline class="w-full min-h-60 object-cover"></video>
        <div class="absolute inset-0 pointer-events-none border-2 border-dashed border-white/30 rounded-2xl m-6"></div>
      </div>

      <p class="text-center text-xs text-zinc-500 dark:text-zinc-400 mt-3">将 2FA 导入二维码放入取景框中，识别后自动填入</p>
      <p class="text-xs font-medium text-red-600 dark:text-red-400 my-2 text-center" v-if="error">{{ error }}</p>

      <div class="mt-4 pt-3 border-t border-white/40 dark:border-white/5">
        <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
          <UiIcon name="image" size="12" class="inline-block align-[-1.5px] mr-1 text-blue-500" />
          或直接上传二维码图片
        </label>
        <input type="file" accept="image/*" class="glass-input w-full file:mr-3 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600/10 file:text-blue-600 dark:file:text-blue-400 hover:file:bg-blue-600/20" @change="onFile" />
      </div>
    </LiquidGlass>
  </div>
</template>
