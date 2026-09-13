<script setup>
// 上传二维码图片 → 解码 → 预览可编辑的 otpauth 条目 → 保存
import { ref } from 'vue';
import { parseOtpauthUri } from '@shared/otpauth.js';
import { decodeQRImage } from '../lib/decodeQR.js';
import UiIcon from './ui/UiIcon.vue';

const emit = defineEmits(['save', 'cancel', 'toast']);
const error = ref('');
const scanning = ref(false);
const preview = ref(null);   // 解码成功后的可编辑条目
const previewImg = ref('');

const inputCls = 'w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors';
const labelCls = 'block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5';

async function onFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  ev.target.value = '';          // 允许重复选择同一文件
  error.value = '';
  scanning.value = true;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  try {
    await img.decode();
    const raw = await decodeQRImage(img);
    if (!raw) throw new Error('图片中未识别到二维码');
    const entry = parseOtpauthUri(raw);
    if (!entry.secret) throw new Error('二维码不包含 2FA secret');
    previewImg.value = img.src;
    preview.value = entry;
  } catch (err) {
    error.value = `解析失败：${err.message}。请上传清晰的 2FA 二维码截图。`;
  } finally {
    scanning.value = false;
  }
}

function save() {
  try {
    if (!preview.value.secret.trim()) throw new Error('secret 不能为空');
    if (!preview.value.issuer.trim() && !preview.value.label.trim()) throw new Error('至少填写 服务名 或 账户名');
    emit('save', { ...preview.value });
  } catch (err) {
    error.value = err.message;
  }
}

function reset() {
  preview.value = null;
  previewImg.value = '';
  error.value = '';
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 sm:p-6 overflow-y-auto" @click.self="emit('cancel')">
    <div class="w-full max-w-lg rounded-2xl sm:rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-7 shadow-xl my-auto">
      <div class="flex items-center justify-between mb-1">
        <h3 class="text-base font-semibold m-0 flex items-center gap-2"><UiIcon name="image" size="17" />上传二维码添加</h3>
        <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" @click="emit('cancel')">
          <UiIcon name="x" size="16" />
        </button>
      </div>
      <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mb-4">选择一张包含 2FA 二维码的图片（截图或照片），自动识别并填入。</p>

      <!-- 选择图片 -->
      <div v-if="!preview">
        <label :class="labelCls">选择二维码图片</label>
        <label class="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-500 transition-colors cursor-pointer py-10 text-zinc-500 dark:text-zinc-400">
          <UiIcon v-if="scanning" name="loader" size="24" class="animate-spin text-blue-500" />
          <UiIcon v-else name="image" size="26" />
          <span class="text-sm">{{ scanning ? '正在识别二维码…' : '点击选择图片' }}</span>
          <span class="text-[11px]">支持 PNG / JPG / WebP，识别在本机完成、不上传</span>
          <input type="file" accept="image/*" class="hidden" @change="onFile" />
        </label>
        <p class="text-[13px] text-red-600 dark:text-red-400 my-2" v-if="error">{{ error }}</p>
      </div>

      <!-- 解码成功：预览编辑 -->
      <div v-else class="space-y-3.5">
        <div class="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
          <img :src="previewImg" class="w-12 h-12 rounded-lg object-contain bg-white dark:bg-zinc-800 p-0.5" alt="二维码" />
          <div class="text-[13px] text-emerald-700 dark:text-emerald-300">
            <p class="font-semibold flex items-center gap-1.5"><UiIcon name="check-circle" size="15" />识别成功，请核对以下信息</p>
          </div>
        </div>

        <div class="flex gap-2.5">
          <div class="flex-1">
            <label :class="labelCls">服务名（issuer）</label>
            <input v-model="preview.issuer" :class="inputCls" />
          </div>
          <div class="flex-1">
            <label :class="labelCls">账户名（label）</label>
            <input v-model="preview.label" :class="inputCls" />
          </div>
        </div>
        <div>
          <label :class="labelCls"><UiIcon name="key" size="12" class="inline-block align-[-1.5px] mr-1" />Secret（Base32）</label>
          <input v-model="preview.secret" spellcheck="false" :class="inputCls + ' otp-font'" />
        </div>

        <p class="text-[13px] text-red-600 dark:text-red-400 my-1" v-if="error">{{ error }}</p>
        <div class="flex gap-2 justify-between mt-2">
          <button class="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm hover:border-blue-500 transition-colors" @click="reset">换一张</button>
          <div class="flex gap-2">
            <button class="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm hover:border-blue-500 transition-colors" @click="emit('cancel')">取消</button>
            <button class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 text-sm transition-colors" @click="save">添加</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>