<script setup>
// 摄像头/图片扫码：jsQR 解码 otpauth:// 二维码
import { ref, onMounted, onBeforeUnmount } from 'vue';
import jsQR from 'jsqr';
import UiIcon from './ui/UiIcon.vue';

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
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);
  const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  if (found?.data) emit('decoded', found.data);
  else error.value = '图片中未识别到二维码';
  URL.revokeObjectURL(img.src);
}

function stop() {
  cancelled = true;
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
}

const inputCls = 'w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors';
</script>

<template>
  <div class="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center p-6 overflow-y-auto" @click.self="emit('cancel'); stop()">
    <div class="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-base font-semibold m-0 flex items-center gap-2"><UiIcon name="scan" size="17" />扫描二维码</h3>
        <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" @click="emit('cancel'); stop()">
          <UiIcon name="x" size="16" />
        </button>
      </div>
      <video ref="videoRef" muted playsinline class="w-full rounded-xl bg-black min-h-60"></video>
      <p class="text-center text-[13px] text-zinc-500 dark:text-zinc-400 mt-2.5">对准 2FA 二维码，识别后自动填入</p>
      <p class="text-[13px] text-red-600 dark:text-red-400 my-2" v-if="error">{{ error }}</p>
      <div class="mt-3">
        <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5"><UiIcon name="image" size="12" class="inline-block align-[-1.5px] mr-1" />或上传二维码图片</label>
        <input type="file" accept="image/*" :class="inputCls" @change="onFile" />
      </div>
    </div>
  </div>
</template>
