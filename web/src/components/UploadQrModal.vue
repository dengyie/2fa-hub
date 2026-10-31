<script setup>
// 上传二维码图片 → 解码 → 预览可编辑的 otpauth 条目 → 保存
import { ref } from 'vue';
import { parseOtpauthUri } from '@shared/otpauth.js';
import { decodeQRImage } from '../lib/decodeQR.js';
import UiIcon from './ui/UiIcon.vue';
import LiquidGlass from './ui/LiquidGlass.vue';

const emit = defineEmits(['save', 'cancel']);
const error = ref('');
const scanning = ref(false);
const preview = ref(null);   // 解码成功后的可编辑条目
const previewObjUrl = ref('');   // 预览用的 blob object URL，需在关闭/重置时回收

const labelCls = 'block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5';

function revokeObjUrl() {
  if (previewObjUrl.value) {
    URL.revokeObjectURL(previewObjUrl.value);
    previewObjUrl.value = '';
  }
}

async function onFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  ev.target.value = '';          // 允许重复选择同一文件
  error.value = '';
  revokeObjUrl();                // 先释放上一张图的 blob URL
  scanning.value = true;
  const objUrl = URL.createObjectURL(file);
  previewObjUrl.value = objUrl;
  const img = new Image();
  img.src = objUrl;
  try {
    await img.decode();
    const raw = await decodeQRImage(img);
    if (!raw) throw new Error('图片中未识别到二维码');
    const entry = parseOtpauthUri(raw);
    if (!entry.secret) throw new Error('二维码不包含 2FA secret');
    preview.value = entry;
  } catch (err) {
    error.value = `解析失败：${err.message}。请上传清晰的 2FA 二维码截图。`;
    // 解码失败不展示预览，立即释放 blob URL，避免二次选图前悬挂占用
    revokeObjUrl();
  } finally {
    scanning.value = false;
  }
}

function save() {
  try {
    if (!preview.value.secret.trim()) throw new Error('secret 不能为空');
    if (!preview.value.issuer.trim() && !preview.value.label.trim()) throw new Error('至少填写 服务名 或 账户名');
    revokeObjUrl();
    emit('save', { ...preview.value });
  } catch (err) {
    error.value = err.message;
  }
}

function reset() {
  preview.value = null;
  revokeObjUrl();
  error.value = '';
}

function close() {
  revokeObjUrl();
  emit('cancel');
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-md flex items-start justify-center p-4 sm:p-6 overflow-y-auto" @click.self="close">
    <LiquidGlass
      variant="modal"
      intensity="thick"
      :interactive="false"
      className="w-full max-w-lg mx-auto my-auto p-6 sm:p-7 shadow-2xl border border-white/70 dark:border-white/12"
    >
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-blue-600/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <UiIcon name="image" size="18" />
          </div>
          <h3 class="text-base font-bold text-zinc-900 dark:text-zinc-100 m-0">上传二维码截图</h3>
        </div>
        <button
          class="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-white/40 dark:hover:bg-white/10 transition-colors"
          @click="close"
        >
          <UiIcon name="x" size="16" />
        </button>
      </div>
      <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mb-4">选择一张包含 2FA 二维码的图片（截图或照片），纯本地解码、不上传网络。</p>

      <!-- 选择图片 -->
      <div v-if="!preview">
        <label class="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/60 dark:border-white/15 hover:border-blue-500/60 dark:hover:border-blue-400/60 bg-white/30 dark:bg-white/5 backdrop-blur-sm transition-all cursor-pointer py-10 px-4 text-zinc-500 dark:text-zinc-400 shadow-2xs group">
          <div class="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center transition-transform group-hover:scale-105">
            <UiIcon v-if="scanning" name="loader" size="24" class="animate-spin text-blue-500" />
            <UiIcon v-else name="image" size="24" />
          </div>
          <span class="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{{ scanning ? '正在识别二维码…' : '点击选择或拖放图片' }}</span>
          <span class="text-[11px] text-zinc-400 dark:text-zinc-500">支持 PNG / JPG / WebP 截图，完全离线安全解析</span>
          <input type="file" accept="image/*" class="hidden" @change="onFile" />
        </label>
        <p class="text-xs font-medium text-red-600 dark:text-red-400 my-2 px-1" v-if="error">{{ error }}</p>
      </div>

      <!-- 解码成功：预览编辑 -->
      <div v-else class="space-y-3.5">
        <div class="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 backdrop-blur-sm p-3 shadow-2xs">
          <img :src="previewObjUrl" class="w-12 h-12 rounded-xl object-contain bg-white dark:bg-zinc-800 p-1 border border-white/40 dark:border-white/10 shrink-0" alt="二维码" />
          <div class="text-xs text-emerald-800 dark:text-emerald-200">
            <p class="font-bold flex items-center gap-1.5"><UiIcon name="check-circle" size="15" class="text-emerald-600 dark:text-emerald-400" />识别成功，请核对信息</p>
            <p class="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">如需微调服务名或账户名，可直接在下方编辑</p>
          </div>
        </div>

        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label :class="labelCls">服务名（issuer）</label>
            <input v-model="preview.issuer" class="glass-input w-full" />
          </div>
          <div>
            <label :class="labelCls">账户名（label）</label>
            <input v-model="preview.label" class="glass-input w-full" />
          </div>
        </div>
        <div>
          <label :class="labelCls"><UiIcon name="key" size="12" class="inline-block align-[-1.5px] mr-1 text-blue-500" />Secret（Base32 密钥）</label>
          <input v-model="preview.secret" spellcheck="false" class="glass-input w-full font-mono text-sm tracking-wider" />
        </div>

        <p class="text-xs font-medium text-red-600 dark:text-red-400 my-1 px-1" v-if="error">{{ error }}</p>
        <div class="flex gap-2 justify-between items-center mt-4 pt-2 border-t border-white/40 dark:border-white/5">
          <button class="glass-btn px-3.5 py-2 text-xs sm:text-sm font-medium" @click="reset">换一张</button>
          <div class="flex gap-2">
            <button class="glass-btn px-4 py-2 text-xs sm:text-sm font-medium" @click="close">取消</button>
            <button class="glass-btn-primary px-5 py-2 text-xs sm:text-sm font-semibold" @click="save">添加条目</button>
          </div>
        </div>
      </div>
    </LiquidGlass>
  </div>
</template>
