<script setup>
import { useRouter } from 'vue-router';
import { store, api } from './store.js';
import UiIcon from './components/ui/UiIcon.vue';
import StatusIndicator from './components/ui/StatusIndicator.vue';
import ThemeToggle from './components/ui/ThemeToggle.vue';

const router = useRouter();
const route = router.currentRoute;

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  store.user = null;
  router.push('/local');
}
</script>

<template>
  <header class="sticky top-0 z-10 bg-zinc-50/85 dark:bg-zinc-950/85 backdrop-blur border-b border-zinc-200/70 dark:border-zinc-800/70">
    <div class="max-w-2xl mx-auto flex items-center gap-2 px-4 py-3">
      <router-link class="text-lg font-bold tracking-tight mr-auto select-none" to="/">
        2fa<span class="text-blue-600 dark:text-blue-400">-hub</span>
      </router-link>

      <!-- 已登录状态 -->
      <template v-if="store.user">
        <router-link class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors"
           :class="route.path === '/vault'
             ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 font-medium'
             : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'"
           to="/vault">
          <UiIcon name="cloud" size="15" /><span class="hidden sm:inline">云端</span>
        </router-link>
        <router-link class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors"
           :class="route.path === '/local'
             ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 font-medium'
             : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'"
           to="/local">
          <UiIcon name="shield" size="15" /><span class="hidden sm:inline">本地</span>
        </router-link>
        <router-link v-if="store.user.is_admin" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors"
           :class="route.path === '/admin'
             ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 font-medium'
             : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'"
           to="/admin">
          <UiIcon name="users" size="15" /><span class="hidden sm:inline">管理</span>
        </router-link>
        <button class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors" @click="logout">
          <UiIcon name="logout" size="15" /><span class="hidden sm:inline">退出</span>
        </button>
      </template>

      <!-- 游客未登录状态：直观呈现本地离线安全与登录入口 -->
      <template v-else>
        <StatusIndicator status="online" label="本地离线安全" class="hidden sm:inline-flex py-0.5 px-2 text-[11px]" />
        <router-link v-if="route.path !== '/login'"
                     class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors font-medium"
                     to="/login">
          <UiIcon name="cloud" size="15" />登录云端
        </router-link>
        <router-link v-else
                     class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-blue-600 dark:text-blue-400 bg-blue-600/10 font-medium transition-colors"
                     to="/local">
          <UiIcon name="shield" size="15" />本地免登
        </router-link>
      </template>

      <ThemeToggle />
    </div>
  </header>
  <main class="max-w-2xl mx-auto px-4 pb-24">
    <router-view />
  </main>
</template>
