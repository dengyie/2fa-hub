<script setup>
// 新建/编辑条目：手工录入 / 粘贴 otpauth URI / 扫码
import { ref, reactive } from 'vue';
import { parseOtpauthUri, isOtpauthUri } from '@shared/otpauth.js';
import ScannerModal from './ScannerModal.vue';
import UiIcon from './ui/UiIcon.vue';
import LiquidGlass from './ui/LiquidGlass.vue';

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

const labelCls = 'block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5';

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
  <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-md flex items-start justify-center p-4 sm:p-6 overflow-y-auto" @click.self="emit('cancel')">
    <LiquidGlass
      variant="modal"
      intensity="thick"
      :interactive="false"
      className="w-full max-w-lg mx-auto my-auto p-6 sm:p-7 shadow-2xl border border-white/70 dark:border-white/12"
    >
      <div class="flex items-center justify-between mb-5">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-blue-600/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <UiIcon :name="initial ? 'edit' : 'plus'" size="18" />
          </div>
          <h3 class="text-base font-bold text-zinc-900 dark:text-zinc-100 m-0">{{ initial ? '编辑 2FA 条目' : '新增 2FA 条目' }}</h3>
        </div>
        <button
          class="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-white/40 dark:hover:bg-white/10 transition-colors"
          @click="emit('cancel')"
        >
          <UiIcon name="x" size="16" />
        </button>
      </div>

      <div class="mb-4">
        <label :class="labelCls">粘贴 otpauth:// 链接 或直接粘贴 secret</label>
        <div class="flex gap-2">
          <input
            v-model="paste"
            placeholder="otpauth://totp/... 或 JBSWY3DPEHPK3PXP"
            class="glass-input flex-1"
            @keydown.enter="onPaste"
          />
          <button type="button" class="glass-btn px-3 text-xs sm:text-sm shrink-0" @click="onPaste">
            解析
          </button>
          <button type="button" class="glass-btn flex items-center gap-1.5 px-3 text-xs sm:text-sm shrink-0" @click="scanning = true">
            <UiIcon name="scan" size="15" />扫码
          </button>
        </div>
      </div>

      <div class="grid sm:grid-cols-2 gap-3 mb-3.5">
        <div>
          <label :class="labelCls">服务名（issuer）</label>
          <input v-model="form.issuer" placeholder="如 GitHub" class="glass-input w-full" />
        </div>
        <div>
          <label :class="labelCls">账户名（label）</label>
          <input v-model="form.label" placeholder="如 alice@example.com" class="glass-input w-full" />
        </div>
      </div>

      <div class="mb-4">
        <label :class="labelCls">
          <UiIcon name="key" size="12" class="inline-block align-[-1.5px] mr-1 text-blue-500" />
          Secret（Base32 密钥）
        </label>
        <input v-model="form.secret" placeholder="JBSWY3DPEHPK3PXP" spellcheck="false" class="glass-input w-full font-mono text-sm tracking-wider" />
      </div>

      <button
        class="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer bg-transparent border-0 p-0 mb-2"
        type="button"
        @click="advanced = !advanced"
      >
        <UiIcon :name="advanced ? 'chevron-down' : 'chevron-right'" size="14" />
        {{ advanced ? '收起算法与周期高级选项' : '算法、周期与类型高级选项' }}
      </button>

      <div v-if="advanced" class="mb-4 p-3.5 rounded-2xl bg-white/40 dark:bg-white/5 border border-white/50 dark:border-white/10 backdrop-blur-sm space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label :class="labelCls">类型</label>
            <select v-model="form.type" class="glass-input w-full text-xs">
              <option value="totp">TOTP（时间型）</option>
              <option value="hotp">HOTP（计数型）</option>
            </select>
          </div>
          <div>
            <label :class="labelCls">算法</label>
            <select v-model="form.algorithm" class="glass-input w-full text-xs">
              <option>SHA1</option>
              <option>SHA256</option>
              <option>SHA512</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label :class="labelCls">位数</label>
            <select v-model.number="form.digits" class="glass-input w-full text-xs">
              <option :value="6">6 位</option>
              <option :value="7">7 位</option>
              <option :value="8">8 位</option>
              <option :value="9">9 位</option>
              <option :value="10">10 位</option>
            </select>
          </div>
          <div v-if="form.type === 'totp'">
            <label :class="labelCls">周期（秒）</label>
            <input v-model.number="form.period" type="number" min="7" max="120" class="glass-input w-full text-xs" />
          </div>
          <div v-else>
            <label :class="labelCls">计数器初始值</label>
            <input v-model.number="form.counter" type="number" min="0" class="glass-input w-full text-xs" />
          </div>
        </div>
      </div>

      <p class="text-xs font-medium text-red-600 dark:text-red-400 my-2 px-1" v-if="error">{{ error }}</p>

      <div class="flex gap-2.5 justify-end mt-5 pt-2 border-t border-white/40 dark:border-white/5">
        <button class="glass-btn px-4 py-2 text-xs sm:text-sm font-medium" @click="emit('cancel')">取消</button>
        <button class="glass-btn-primary px-5 py-2 text-xs sm:text-sm font-semibold" @click="submit">
          {{ initial ? '保存更改' : '添加条目' }}
        </button>
      </div>
    </LiquidGlass>

    <ScannerModal v-if="scanning" @decoded="onScanned" @cancel="scanning = false" />
  </div>
</template>
