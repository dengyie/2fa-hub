<script setup>
// 新建/编辑条目：手工录入 / 粘贴 otpauth URI / 扫码
import { ref, reactive } from 'vue';
import { parseOtpauthUri, isOtpauthUri } from '@shared/otpauth.js';
import ScannerModal from './ScannerModal.vue';
import UiIcon from './ui/UiIcon.vue';

const props = defineProps({
  initial: { type: Object, default: null }, // null = 新建
});
const emit = defineEmits(['save', 'cancel', 'toast']);

const form = reactive({
  type: props.initial?.type || 'totp',
  issuer: props.initial?.issuer || '',
  label: props.initial?.label || '',
  secret: props.initial?.secret || '',
  algorithm: props.initial?.algorithm || 'SHA1',
  digits: props.initial?.digits || 6,
  period: props.initial?.period || 30,
  counter: props.initial?.counter || 0,
});
const advanced = ref(false);
const error = ref('');
const paste = ref('');
const scanning = ref(false);

const inputCls = 'w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors';
const labelCls = 'block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5';

function applyUri(uri) {
  try {
    const e = parseOtpauthUri(uri);
    Object.assign(form, e);
    error.value = '';
  } catch (err) {
    error.value = `解析失败：${err.message}`;
  }
}

function onPaste() {
  const v = paste.value.trim();
  if (!v) return;
  if (isOtpauthUri(v)) applyUri(v);
  else { form.secret = v.replace(/\s+/g, '').toUpperCase(); error.value = ''; }
  paste.value = '';
}

function submit() {
  try {
    if (!form.secret.trim()) throw new Error('secret 不能为空');
    if (!form.issuer.trim() && !form.label.trim()) throw new Error('至少填写 服务名 或 账户名');
    emit('save', { ...props.initial, ...form });
  } catch (err) {
    error.value = err.message;
  }
}

function onScanned(uri) {
  scanning.value = false;
  applyUri(uri);
  emit('toast', '扫码成功，请核对信息');
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-6 overflow-y-auto" @click.self="emit('cancel')">
    <div class="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
      <div class="flex items-center justify-between mb-5">
        <h3 class="text-base font-semibold m-0">{{ initial ? '编辑条目' : '新增条目' }}</h3>
        <button class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" @click="emit('cancel')">
          <UiIcon name="x" size="16" />
        </button>
      </div>

      <div class="mb-3.5">
        <label :class="labelCls">粘贴 otpauth:// 链接 或直接粘贴 secret</label>
        <div class="flex gap-2">
          <input v-model="paste" placeholder="otpauth://totp/... 或 JBSWY3DPEHPK3PXP" :class="inputCls" @keydown.enter="onPaste" />
          <button type="button" class="shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 text-sm hover:border-blue-500 transition-colors" @click="onPaste">解析</button>
          <button type="button" class="shrink-0 flex items-center gap-1 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 text-sm hover:border-blue-500 transition-colors" @click="scanning = true">
            <UiIcon name="scan" size="15" />扫码
          </button>
        </div>
      </div>

      <div class="flex gap-2.5">
        <div class="flex-1 mb-3.5">
          <label :class="labelCls">服务名（issuer）</label>
          <input v-model="form.issuer" placeholder="如 GitHub" :class="inputCls" />
        </div>
        <div class="flex-1 mb-3.5">
          <label :class="labelCls">账户名（label）</label>
          <input v-model="form.label" placeholder="如 alice@example.com" :class="inputCls" />
        </div>
      </div>
      <div class="mb-3.5">
        <label :class="labelCls"><UiIcon name="key" size="12" class="inline-block align-[-1.5px] mr-1" />Secret（Base32）</label>
        <input v-model="form.secret" placeholder="JBSWY3DPEHPK3PXP" spellcheck="false" :class="inputCls + ' otp-font'" />
      </div>

      <button class="flex items-center gap-1 text-[13px] text-blue-600 dark:text-blue-400 bg-transparent border-0 p-0" type="button" @click="advanced = !advanced">
        <UiIcon :name="advanced ? 'chevron-down' : 'chevron-right'" size="13" />
        {{ advanced ? '收起高级选项' : '高级选项' }}
      </button>
      <div v-if="advanced" class="mt-3">
        <div class="flex gap-2.5">
          <div class="flex-1 mb-3.5">
            <label :class="labelCls">类型</label>
            <select v-model="form.type" :class="inputCls">
              <option value="totp">TOTP（时间型）</option>
              <option value="hotp">HOTP（计数型）</option>
            </select>
          </div>
          <div class="flex-1 mb-3.5">
            <label :class="labelCls">算法</label>
            <select v-model="form.algorithm" :class="inputCls">
              <option>SHA1</option><option>SHA256</option><option>SHA512</option>
            </select>
          </div>
        </div>
        <div class="flex gap-2.5">
          <div class="flex-1 mb-3.5">
            <label :class="labelCls">位数</label>
            <select v-model.number="form.digits" :class="inputCls">
              <option :value="6">6</option><option :value="7">7</option>
              <option :value="8">8</option><option :value="9">9</option><option :value="10">10</option>
            </select>
          </div>
          <div class="flex-1 mb-3.5" v-if="form.type === 'totp'">
            <label :class="labelCls">周期（秒）</label>
            <input v-model.number="form.period" type="number" min="7" max="120" :class="inputCls" />
          </div>
          <div class="flex-1 mb-3.5" v-else>
            <label :class="labelCls">计数器</label>
            <input v-model.number="form.counter" type="number" min="0" :class="inputCls" />
          </div>
        </div>
      </div>

      <p class="text-[13px] text-red-600 dark:text-red-400 my-2" v-if="error">{{ error }}</p>
      <div class="flex gap-2 justify-end mt-4">
        <button class="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm hover:border-blue-500 transition-colors" @click="emit('cancel')">取消</button>
        <button class="rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 text-sm transition-colors" @click="submit">{{ initial ? '保存' : '添加' }}</button>
      </div>
    </div>

    <ScannerModal v-if="scanning" @decoded="onScanned" @cancel="scanning = false" />
  </div>
</template>
