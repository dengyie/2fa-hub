<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { store, api } from '../store.js';
import UiIcon from '../components/ui/UiIcon.vue';
import TurnstileWidget from '../components/TurnstileWidget.vue';

const router = useRouter();
const mode = ref('login');
const email = ref('');
const name = ref('');
const password = ref('');
const inviteCode = ref('');
const error = ref('');
const busy = ref(false);
const registerMode = ref('open');
const registerOpen = ref(true);
const turnstileSiteKey = ref('');
const turnstileToken = ref('');
const turnstileWidgetRef = ref(null);

onMounted(async () => {
  try {
    const boot = await api('/api/bootstrap');
    registerMode.value = boot.register_mode || 'open';
    registerOpen.value = boot.register_mode === 'open' || boot.register_mode === 'invite' || !boot.initialized;
    if (boot.turnstile_sitekey) {
      turnstileSiteKey.value = boot.turnstile_sitekey;
    }
  } catch {
    /* 服务器未启动或离线时保持默认 */
  }
});

function handleTurnstileVerify(token) {
  turnstileToken.value = token;
  error.value = '';
}

function handleTurnstileExpire() {
  turnstileToken.value = '';
}

function handleTurnstileError() {
  turnstileToken.value = '';
}

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    const path = mode.value === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = { email: email.value, password: password.value };

    if (mode.value === 'register') {
      body.name = name.value;
      if (registerMode.value === 'invite') {
        body.invite_code = inviteCode.value;
      }
      if (turnstileSiteKey.value) {
        if (!turnstileToken.value) {
          throw new Error('请先完成 Cloudflare Turnstile 人机安全验证');
        }
        body.turnstile_token = turnstileToken.value;
      }
    }

    const r = await api(path, { method: 'POST', body });
    store.user = r.user;
    router.push('/vault');
  } catch (err) {
    error.value = err.message;
    if (mode.value === 'register' && turnstileWidgetRef.value) {
      turnstileWidgetRef.value.reset();
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="max-w-sm mx-auto mt-[8vh]">
    <h1 class="text-center text-2xl font-bold mb-1.5">2fa<span class="text-blue-600 dark:text-blue-400">-hub</span></h1>
    <p class="text-center text-[13px] text-zinc-500 dark:text-zinc-400 mb-6">
      自托管的双模式 2FA 保险库 · 登录云端同步，或
      <router-link to="/local" class="text-blue-600 dark:text-blue-400 hover:underline">使用本地免登录模式</router-link>
    </p>

    <div class="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
      <div class="flex mb-5 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 p-0.5">
        <button
          class="flex-1 py-2 rounded-[10px] text-sm transition-colors"
          :class="mode === 'login' ? 'bg-white dark:bg-zinc-900 font-semibold shadow-sm' : 'text-zinc-500 dark:text-zinc-400'"
          @click="mode = 'login'"
        >
          登录
        </button>
        <button
          class="flex-1 py-2 rounded-[10px] text-sm transition-colors relative"
          :class="mode === 'register' ? 'bg-white dark:bg-zinc-900 font-semibold shadow-sm' : 'text-zinc-500 dark:text-zinc-400'"
          @click="mode = 'register'"
        >
          注册
          <span v-if="!registerOpen" class="text-[10px] text-zinc-400 ml-0.5">(已关闭)</span>
        </button>
      </div>

      <!-- 注册关闭警告 -->
      <div v-if="mode === 'register' && !registerOpen" class="text-center py-6">
        <UiIcon name="lock" size="24" class="mx-auto text-zinc-400 mb-2" />
        <p class="text-sm font-semibold text-zinc-700 dark:text-zinc-300">公开注册暂未开放</p>
        <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">管理员已关闭新用户注册。已注册用户请切换到「登录」模式。</p>
        <button
          class="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors"
          @click="mode = 'login'"
        >
          切换至登录
        </button>
      </div>

      <form v-else class="space-y-3.5" @submit.prevent="submit">
        <div>
          <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">邮箱</label>
          <input
            v-model="email"
            type="email"
            autocomplete="username"
            required
            placeholder="alice@example.com"
            class="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        <div v-if="mode === 'register'">
          <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">昵称</label>
          <input
            v-model="name"
            autocomplete="nickname"
            placeholder="可选（如 Alice）"
            class="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        <div>
          <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">密码</label>
          <input
            v-model="password"
            type="password"
            minlength="8"
            required
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            placeholder="至少 8 位字符"
            class="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        <!-- 邀请码模式 -->
        <div v-if="mode === 'register' && registerMode === 'invite'">
          <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">邀请码</label>
          <input
            v-model="inviteCode"
            required
            placeholder="请输入管理员提供的邀请码"
            class="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        <!-- 注册时 Cloudflare Turnstile 人机验证 -->
        <div v-if="mode === 'register' && turnstileSiteKey" class="pt-1">
          <div class="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 mb-1 px-0.5">
            <span class="flex items-center gap-1">
              <UiIcon name="shield" size="12" class="text-blue-500" />
              <span>人机安全验证</span>
            </span>
            <span class="text-zinc-400 dark:text-zinc-500">Cloudflare Turnstile</span>
          </div>
          <TurnstileWidget
            ref="turnstileWidgetRef"
            :sitekey="turnstileSiteKey"
            @verify="handleTurnstileVerify"
            @expire="handleTurnstileExpire"
            @error="handleTurnstileError"
          />
        </div>

        <p class="text-[13px] text-red-600 dark:text-red-400" v-if="error">{{ error }}</p>

        <button
          type="submit"
          :disabled="busy || (mode === 'register' && turnstileSiteKey && !turnstileToken)"
          class="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 text-sm transition-colors disabled:opacity-50"
        >
          <UiIcon v-if="busy" name="loader" size="16" class="animate-spin" />
          {{ mode === 'login' ? '登录' : '创建账户' }}
        </button>
      </form>
    </div>

    <p class="text-xs text-zinc-500 dark:text-zinc-400 text-center mt-4 leading-relaxed">
      <UiIcon name="shield" size="13" class="inline-block align-[-2px] mr-1 text-emerald-500" />
      全量 2FA 密文均使用 AES-256-GCM 独立加密落盘
    </p>
  </div>
</template>
