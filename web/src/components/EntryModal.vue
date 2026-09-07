<script setup>
// 新建/编辑条目：手工录入 / 粘贴 otpauth URI / 扫码
import { ref, reactive } from 'vue';
import { parseOtpauthUri, isOtpauthUri } from '@shared/otpauth.js';
import ScannerModal from './ScannerModal.vue';

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
  <div class="overlay" @click.self="emit('cancel')">
    <div class="modal">
      <h3>{{ initial ? '编辑条目' : '新增条目' }}</h3>

      <div class="field">
        <label>粘贴 otpauth:// 链接 或直接粘贴 secret</label>
        <div class="field-row">
          <input v-model="paste" placeholder="otpauth://totp/... 或 JBSWY3DPEHPK3PXP" @keydown.enter="onPaste" />
          <button class="btn" type="button" @click="onPaste">解析</button>
          <button class="btn" type="button" @click="scanning = true">📷 扫码</button>
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label>服务名（issuer）</label>
          <input v-model="form.issuer" placeholder="如 GitHub" />
        </div>
        <div class="field">
          <label>账户名（label）</label>
          <input v-model="form.label" placeholder="如 alice@example.com" />
        </div>
      </div>
      <div class="field">
        <label>Secret（Base32）</label>
        <input v-model="form.secret" placeholder="JBSWY3DPEHPK3PXP" spellcheck="false" />
      </div>

      <button class="adv-toggle" type="button" @click="advanced = !advanced">
        {{ advanced ? '▾ 收起高级选项' : '▸ 高级选项' }}
      </button>
      <div v-if="advanced" style="margin-top: 12px">
        <div class="field-row">
          <div class="field">
            <label>类型</label>
            <select v-model="form.type">
              <option value="totp">TOTP（时间型）</option>
              <option value="hotp">HOTP（计数型）</option>
            </select>
          </div>
          <div class="field">
            <label>算法</label>
            <select v-model="form.algorithm">
              <option>SHA1</option><option>SHA256</option><option>SHA512</option>
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>位数</label>
            <select v-model.number="form.digits">
              <option :value="6">6</option><option :value="7">7</option>
              <option :value="8">8</option><option :value="9">9</option><option :value="10">10</option>
            </select>
          </div>
          <div class="field" v-if="form.type === 'totp'">
            <label>周期（秒）</label>
            <input v-model.number="form.period" type="number" min="7" max="120" />
          </div>
          <div class="field" v-else>
            <label>计数器</label>
            <input v-model.number="form.counter" type="number" min="0" />
          </div>
        </div>
      </div>

      <p class="error-text" v-if="error">{{ error }}</p>
      <div class="modal-actions">
        <button class="btn" @click="emit('cancel')">取消</button>
        <button class="btn primary" @click="submit">{{ initial ? '保存' : '添加' }}</button>
      </div>
    </div>

    <ScannerModal v-if="scanning" @decoded="onScanned" @cancel="scanning = false" />
  </div>
</template>
