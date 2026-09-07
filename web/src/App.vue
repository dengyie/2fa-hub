<script setup>
import { useRouter } from 'vue-router';
import { store, api } from './store.js';
import UiIcon from './components/ui/UiIcon.vue';
import ThemeToggle from './components/ui/ThemeToggle.vue';

const router = useRouter();
const route = router.currentRoute;

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  store.user = null;
  router.push('/login');
}
</script>

<template>
  <header class="sticky top-0 z-10 bg-zinc-50/85 dark:bg-zinc-950/85 backdrop-blur border-b border-zinc-200/70 dark:border-zinc-800/70">
    <div class="max-w-2xl mx-auto flex items-center gap-2 px-4 py-3">
      <a class="text-lg font-bold tracking-tight mr-auto select-none" href="/vault">
        2fa<span class="text-blue-600 dark:text-blue-400">-hub</span>
      </a>
      <template v-if="store.user">
        <a class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors"
           :class="route.path === '/vault'
             ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 font-medium'
             : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'"
           href="/vault">
          <UiIcon name="cloud" size="15" /><span class="hidden sm:inline">云端</span>
        </a>
        <a class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors"
           :class="route.path === '/local'
             ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 font-medium'
             : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'"
           href="/local">
          <UiIcon name="lock" size="15" /><span class="hidden sm:inline">本地</span>
        </a>
        <a v-if="store.user.is_admin" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors"
           :class="route.path === '/admin'
             ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 font-medium'
             : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'"
           href="/admin">
          <UiIcon name="users" size="15" /><span class="hidden sm:inline">管理</span>
        </a>
        <button class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors" @click="logout">
          <UiIcon name="logout" size="15" /><span class="hidden sm:inline">退出</span>
        </button>
      </template>
      <a v-else class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors"
         :class="route.path === '/local'
           ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400 font-medium'
           : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'"
         href="/local">
        <UiIcon name="lock" size="15" />本地模式
      </a>
      <ThemeToggle />
    </div>
  </header>
  <main class="max-w-2xl mx-auto px-4 pb-24">
    <router-view />
  </main>
</template>
