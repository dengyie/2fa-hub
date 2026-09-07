<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { store, api } from '../store.js';

const router = useRouter();
const mode = ref('login');
const email = ref('');
const name = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);
const registerOpen = ref(true);

onMounted(async () => {
  try {
    const boot = await api('/api/bootstrap');
    registerOpen.value = boot.register_mode === 'open' || !boot.initialized;
  } catch { /* 服务器未启动时保持默认 */ }
});

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    const path = mode.value === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = { email: email.value, password: password.value };
    if (mode.value === 'register') body.name = name.value;
    const r = await api(path, { method: 'POST', body });
    store.user = r.user;
    router.push('/vault');
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <h1>2fa-<span>hub</span></h1>
    <p class="auth-sub">自托管的 2FA 验证码保险库 · 登录云端同步，或 <a href="/local" style="color: var(--accent)">使用本地模式</a></p>
    <div class="auth-card">
      <div class="tabs">
        <button :class="{ on: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button v-if="registerOpen" :class="{ on: mode === 'register' }" @click="mode = 'register'">注册</button>
      </div>
      <form @submit.prevent="submit">
        <div class="field">
          <label>邮箱</label>
          <input v-model="email" type="email" autocomplete="username" required />
        </div>
        <div class="field" v-if="mode === 'register'">
          <label>昵称</label>
          <input v-model="name" autocomplete="nickname" placeholder="可选" />
        </div>
        <div class="field">
          <label>密码</label>
          <input v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" required minlength="8" placeholder="至少 8 位" />
        </div>
        <p class="error-text" v-if="error">{{ error }}</p>
        <button class="btn primary" style="width: 100%" :disabled="busy">
          {{ mode === 'login' ? '登录' : '创建账户' }}
        </button>
      </form>
    </div>
    <p class="hint" style="text-align: center; margin-top: 14px">
      系统首个注册用户自动成为管理员。
    </p>
  </div>
</template>
