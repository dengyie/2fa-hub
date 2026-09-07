<script setup>
// 导入向导：支持 2fa-hub JSON / 纯文本 otpauth URI / 2FAS / Aegis 明文
import { ref } from 'vue';
import { detectAndParse } from '../lib/formats.js';

const emit = defineEmits(['import', 'cancel']);
const error = ref('');
const parsed = ref([]);
const rawText = ref('');

async function onFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  rawText.value = await file.text();
  parse();
}

function parse() {
  error.value = '';
  parsed.value = [];
  try {
    const list = detectAndParse(rawText.value);
    if (!list.length) throw new Error('没有解析出任何条目');
    parsed.value = list;
  } catch (err) {
    error.value = err.message;
  }
}

function confirmImport() {
  emit('import', parsed.value.map(({ source, ...e }) => e));
}
</script>

<template>
  <div class="overlay" @click.self="emit('cancel')">
    <div class="modal">
      <h3>导入条目</h3>
      <p class="hint">支持：2fa-hub JSON · 纯文本 otpauth:// 链接（每行一条）· 2FAS 导出 · Aegis 明文导出。加密的 Aegis 备份请先解密导出。</p>

      <div class="field" v-if="!parsed.length">
        <label>选择文件</label>
        <input type="file" accept=".json,.txt,.md" @change="onFile" />
      </div>
      <div class="field" v-if="!parsed.length">
        <label>或粘贴内容</label>
        <textarea v-model="rawText" rows="5" placeholder="otpauth://totp/GitHub:alice?secret=..."></textarea>
        <button class="btn small" style="margin-top: 6px" @click="parse">解析</button>
      </div>

      <p class="error-text" v-if="error">{{ error }}</p>

      <template v-if="parsed.length">
        <p class="hint">解析出 {{ parsed.length }} 条：</p>
        <div class="card-list" style="max-height: 240px; overflow-y: auto">
          <div class="otp-card" v-for="(e, i) in parsed" :key="i" style="padding: 8px 12px">
            <div class="otp-icon" style="width: 28px; height: 28px; font-size: 12px">{{ (e.issuer || '?').slice(0, 1) }}</div>
            <div class="otp-meta">
              <div class="otp-label" style="font-size: 13px">{{ e.issuer || '(无服务名)' }}</div>
              <div class="otp-issuer">{{ e.label || '(无账户名)' }} · {{ e.type }}</div>
            </div>
          </div>
        </div>
      </template>

      <div class="modal-actions">
        <button class="btn" @click="emit('cancel')">取消</button>
        <button v-if="parsed.length" class="btn primary" @click="confirmImport">全部导入（{{ parsed.length }}）</button>
      </div>
    </div>
  </div>
</template>
