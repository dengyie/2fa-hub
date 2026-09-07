<script setup>
// 摄像头/图片扫码：jsQR 解码 otpauth:// 二维码
import { ref, onMounted, onBeforeUnmount } from 'vue';
import jsQR from 'jsqr';

const emit = defineEmits(['decoded', 'cancel']);
const error = ref('');
const videoRef = ref(null);

let stream = null;
let raf = 0;
let canvasCtx = null;

onMounted(startCamera);
onBeforeUnmount(stop);

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }, audio: false,
    });
    videoRef.value.srcObject = stream;
    await videoRef.value.play();
    const canvas = document.createElement('canvas');
    canvasCtx = canvas.getContext('2d', { willReadFrequently: true });
    tick(canvas, videoRef.value);
  } catch (err) {
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
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
}
</script>

<template>
  <div class="overlay" @click.self="emit('cancel')">
    <div class="modal">
      <h3>扫描二维码</h3>
      <video id="scan-video" ref="videoRef" muted playsinline></video>
      <p class="scan-tip">对准 2FA 二维码，识别后自动填入</p>
      <p class="error-text" v-if="error">{{ error }}</p>
      <div class="field">
        <label>或上传二维码图片</label>
        <input type="file" accept="image/*" @change="onFile" />
      </div>
      <div class="modal-actions">
        <button class="btn" @click="emit('cancel'); stop()">关闭</button>
      </div>
    </div>
  </div>
</template>
