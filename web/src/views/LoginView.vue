<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { store, api } from '../store.js';
import UiIcon from '../components/ui/UiIcon.vue';
import TurnstileWidget from '../components/TurnstileWidget.vue';
import LiquidGlass from '../components/ui/LiquidGlass.vue';

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
  <div class="max-w-sm mx-auto mt-[6vh] sm:mt-[8vh]">
    <div class="text-center mb-6">
      <div class="w-16 h-16 rounded-3xl bg-white/70 dark:bg-white/5 border border-white/60 dark:border-white/10 p-2.5 flex items-center justify-center mx-auto mb-3.5 shadow-[0_8px_24px_rgba(245,158,11,0.25),inset_0_1px_1px_rgba(255,255,255,0.8)] backdrop-blur-md">
        <img src="/logo.png" alt="2fa-hub Logo" class="w-full h-full object-contain drop-shadow-sm select-none" />
      </div>
      <h1 class="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
        2fa<span class="text-blue-600 dark:text-blue-400 font-extrabold">-hub</span>
      </h1>
      <p class="text-xs sm:text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">
        双模式 2FA 保险库 · 登录云端同步，或
        <router-link to="/local" class="text-blue-600 dark:text-blue-400 hover:underline font-medium">使用本地免登模式</router-link>
      </p>
    </div>

    <!-- 液体玻璃登录/注册卡片 (Liquid Glass Auth Container) -->
    <LiquidGlass
      variant="card"
      intensity="regular"
      :interactive="true"
      :enableTilt="true"
      :maxTilt="3"
      className="p-6 sm:p-7 shadow-[0_12px_44px_rgba(0,0,0,0.08),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_16px_48px_rgba(0,0,0,0.45),inset_0_1px_1px_rgba(255,255,255,0.18)]"
    >
      <!-- 分段切换胶囊 (Liquid Glass Segmented Control) -->
      <div class="flex mb-5 p-1 rounded-2xl bg-black/5 dark:bg-white/5 border border-white/40 dark:border-white/5 backdrop-blur-sm">
        <button
          class="flex-1 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200"
          :class="mode === 'login'
            ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-[0_2px_8px_rgba(0,0,0,0.08),inset_0_1px_1px_rgba(255,255,255,0.8)]'
            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'"
          @click="mode = 'login'"
        >
          登录云端
        </button>
        <button
          class="flex-1 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 relative"
          :class="mode === 'register'
            ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-[0_2px_8px_rgba(0,0,0,0.08),inset_0_1px_1px_rgba(255,255,255,0.8)]'
            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'"
          @click="mode = 'register'"
        >
          注册新号
          <span v-if="!registerOpen" class="text-[10px] text-zinc-400 ml-0.5">(已关)</span>
        </button>
      </div>

      <!-- 注册关闭警告 -->
      <div v-if="mode === 'register' && !registerOpen" class="text-center py-6">
        <div class="w-10 h-10 rounded-2xl bg-zinc-200/50 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-2 text-zinc-400">
          <UiIcon name="lock" size="20" />
        </div>
        <p class="text-sm font-semibold text-zinc-700 dark:text-zinc-300">公开注册暂未开放</p>
        <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">管理员已关闭新用户注册。已注册用户请切换到「登录」模式。</p>
        <button
          class="glass-btn-primary mt-4 px-4 py-2 text-xs"
          @click="mode = 'login'"
        >
          切换至登录
        </button>
      </div>

      <form v-else class="space-y-3.5" @submit.prevent="submit">
        <div>
          <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">邮箱账号</label>
          <input
            v-model="email"
            type="email"
            autocomplete="username"
            required
            placeholder="alice@example.com"
            class="glass-input w-full"
          />
        </div>

        <div v-if="mode === 'register'">
          <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">用户昵称</label>
          <input
            v-model="name"
            autocomplete="nickname"
            placeholder="可选（如 Alice）"
            class="glass-input w-full"
          />
        </div>

        <div>
          <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">登录密码</label>
          <input
            v-model="password"
            type="password"
            minlength="8"
            required
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            placeholder="至少 8 位字符"
            class="glass-input w-full"
          />
        </div>

        <!-- 邀请码模式 -->
        <div v-if="mode === 'register' && registerMode === 'invite'">
          <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">邀请码</label>
          <input
            v-model="inviteCode"
            required
            placeholder="请输入管理员提供的邀请码"
            class="glass-input w-full"
          />
        </div>

        <!-- 注册时 Cloudflare Turnstile 人机验证 -->
        <div v-if="mode === 'register' && turnstileSiteKey" class="pt-1">
          <div class="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 mb-1 px-0.5">
            <span class="flex items-center gap-1 font-medium">
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

        <p class="text-xs text-red-600 dark:text-red-400 font-medium px-0.5" v-if="error">{{ error }}</p>

        <button
          type="submit"
          :disabled="busy || (mode === 'register' && turnstileSiteKey && !turnstileToken)"
          class="glass-btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-50"
        >
          <UiIcon v-if="busy" name="loader" size="16" class="animate-spin" />
          {{ mode === 'login' ? '安全登录' : '创建账户' }}
        </button>
      </form>
    </LiquidGlass>

    <p class="text-xs text-zinc-500 dark:text-zinc-400 text-center mt-5 leading-relaxed">
      <UiIcon name="shield" size="13" class="inline-block align-[-2px] mr-1 text-emerald-500" />
      全量 2FA 密文均使用 AES-256-GCM 独立加密落盘
    </p>
  </div>
</template>
