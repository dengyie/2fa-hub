<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { store, api } from '../store.js';
import UiIcon from '../components/ui/UiIcon.vue';

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
  <div class="max-w-sm mx-auto mt-[10vh]">
    <h1 class="text-center text-2xl font-bold mb-1.5">2fa<span class="text-blue-600 dark:text-blue-400">-hub</span></h1>
    <p class="text-center text-[13px] text-zinc-500 dark:text-zinc-400 mb-7">
      自托管的双模式 2FA 保险库 · 登录云端同步，或
      <router-link to="/local" class="text-blue-600 dark:text-blue-400 hover:underline">使用本地模式</router-link>
    </p>
    <div class="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
      <div class="flex mb-5 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 p-0.5">
        <button class="flex-1 py-2 rounded-[10px] text-sm transition-colors"
                :class="mode === 'login' ? 'bg-white dark:bg-zinc-900 font-semibold shadow-sm' : 'text-zinc-500 dark:text-zinc-400'"
                @click="mode = 'login'">登录</button>
        <button v-if="registerOpen" class="flex-1 py-2 rounded-[10px] text-sm transition-colors"
                :class="mode === 'register' ? 'bg-white dark:bg-zinc-900 font-semibold shadow-sm' : 'text-zinc-500 dark:text-zinc-400'"
                @click="mode = 'register'">注册</button>
      </div>
      <form class="space-y-3.5" @submit.prevent="submit">
        <div>
          <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">邮箱</label>
          <input v-model="email" type="email" autocomplete="username" required
                 class="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500 transition-colors" />
        </div>
        <div v-if="mode === 'register'">
          <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">昵称</label>
          <input v-model="name" autocomplete="nickname" placeholder="可选"
                 class="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500 transition-colors" />
        </div>
        <div>
          <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">密码</label>
          <input v-model="password" type="password" minlength="8" required
                 :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
                 placeholder="至少 8 位"
                 class="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500 transition-colors" />
        </div>
        <p class="text-[13px] text-red-600 dark:text-red-400" v-if="error">{{ error }}</p>
        <button type="submit" :disabled="busy"
                class="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 text-sm transition-colors disabled:opacity-50">
          <UiIcon v-if="busy" name="loader" size="16" class="animate-spin" />
          {{ mode === 'login' ? '登录' : '创建账户' }}
        </button>
      </form>
    </div>
    <p class="text-xs text-zinc-500 dark:text-zinc-400 text-center mt-4 leading-relaxed">
      <UiIcon name="shield" size="13" class="inline-block align-[-2px] mr-1" />
      系统首个注册用户自动成为管理员
    </p>
  </div>
</template>
