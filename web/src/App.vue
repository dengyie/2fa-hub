<script setup>
import { useRouter } from 'vue-router';
import { store, api } from './store.js';
import UiIcon from './components/ui/UiIcon.vue';
import StatusIndicator from './components/ui/StatusIndicator.vue';
import ThemeToggle from './components/ui/ThemeToggle.vue';
import LiquidGlass from './components/ui/LiquidGlass.vue';

const router = useRouter();
const route = router.currentRoute;

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  store.user = null;
  router.push('/local');
}
</script>

<template>
  <!-- 背景光学采样环境层 (Ambient Color Blobs & Mesh for Optical Refraction) -->
  <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden select-none" aria-hidden="true">
    <!-- Top-left subtle indigo/blue refraction source -->
    <div
      class="absolute -top-[15%] -left-[10%] w-[580px] h-[580px] rounded-full bg-gradient-to-br from-blue-400/20 via-indigo-500/15 to-transparent dark:from-blue-600/18 dark:via-indigo-800/12 blur-[100px] sm:blur-[130px] motion-reduce:hidden transform-gpu"
    />
    <!-- Top-right cyan/sky refraction source -->
    <div
      class="absolute top-[5%] -right-[12%] w-[500px] h-[500px] rounded-full bg-gradient-to-bl from-cyan-400/18 via-sky-400/12 to-transparent dark:from-cyan-500/12 dark:via-sky-800/10 blur-[90px] sm:blur-[120px] motion-reduce:hidden transform-gpu"
    />
    <!-- Center-bottom purple/emerald subtle glow -->
    <div
      class="absolute bottom-[-10%] left-[20%] w-[640px] h-[480px] rounded-full bg-gradient-to-tr from-purple-400/10 via-emerald-400/8 to-transparent dark:from-purple-900/12 dark:via-teal-800/8 blur-[110px] sm:blur-[140px] motion-reduce:hidden transform-gpu"
    />
  </div>

  <!-- 顶部悬浮液体玻璃导航胶囊 (Floating Liquid Glass Capsule Header) -->
  <header class="sticky top-3 z-30 px-3 sm:px-6 lg:px-8 max-w-7xl mx-auto mb-2">
    <LiquidGlass
      variant="none"
      intensity="thick"
      :enableTilt="false"
      className="rounded-2xl sm:rounded-full px-4 sm:px-5 py-2.5 flex items-center justify-between gap-3 bg-white/75 dark:bg-[#12141a]/75 border border-white/70 dark:border-white/12 shadow-[0_8px_32px_rgba(0,0,0,0.06),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.45),inset_0_1px_1px_rgba(255,255,255,0.18)]"
    >
      <div class="flex items-center gap-3 mr-auto">
        <router-link
          class="flex items-center gap-2 group text-base sm:text-lg font-bold tracking-tight select-none focus:outline-none"
          to="/"
        >
          <div class="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center shadow-[0_2px_10px_rgba(37,99,235,0.35),inset_0_1px_1px_rgba(255,255,255,0.6)] group-hover:scale-105 transition-transform">
            <UiIcon name="shield" size="16" />
          </div>
          <span class="text-zinc-900 dark:text-zinc-100">2fa<span class="text-blue-600 dark:text-blue-400 font-extrabold">-hub</span></span>
        </router-link>
      </div>

      <!-- 导航功能区 -->
      <nav class="flex items-center gap-1.5 sm:gap-2">
        <!-- 已登录状态 -->
        <template v-if="store.user">
          <router-link
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all duration-200"
            :class="route.path === '/vault'
              ? 'bg-blue-600/15 text-blue-600 dark:text-blue-400 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]'
              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5'"
            to="/vault"
          >
            <UiIcon name="cloud" size="14" />
            <span class="hidden sm:inline">云端保险库</span>
            <span class="sm:hidden">云端</span>
          </router-link>

          <router-link
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all duration-200"
            :class="route.path === '/local'
              ? 'bg-blue-600/15 text-blue-600 dark:text-blue-400 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]'
              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5'"
            to="/local"
          >
            <UiIcon name="shield" size="14" />
            <span class="hidden sm:inline">本地免登</span>
            <span class="sm:hidden">本地</span>
          </router-link>

          <router-link
            v-if="store.user.is_admin"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all duration-200"
            :class="route.path === '/admin'
              ? 'bg-blue-600/15 text-blue-600 dark:text-blue-400 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]'
              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5'"
            to="/admin"
          >
            <UiIcon name="users" size="14" />
            <span class="hidden sm:inline">系统管理</span>
            <span class="sm:hidden">管理</span>
          </router-link>

          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
            title="退出登录"
            @click="logout"
          >
            <UiIcon name="logout" size="14" />
            <span class="hidden sm:inline">退出</span>
          </button>
        </template>

        <!-- 游客未登录状态 -->
        <template v-else>
          <StatusIndicator status="online" label="本地离线安全" class="hidden sm:inline-flex py-0.5 px-2.5 text-[11px] rounded-full" />
          <router-link
            v-if="route.path !== '/login'"
            class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400 bg-white/50 dark:bg-white/5 border border-white/60 dark:border-white/10 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-md transition-all duration-200"
            to="/login"
          >
            <UiIcon name="cloud" size="14" />
            <span>登录云端</span>
          </router-link>
          <router-link
            v-else
            class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-600/10 border border-blue-500/20 shadow-sm transition-all duration-200"
            to="/local"
          >
            <UiIcon name="shield" size="14" />
            <span>本地免登</span>
          </router-link>
        </template>

        <div class="w-px h-4 bg-zinc-200 dark:bg-zinc-800 mx-0.5" />
        <ThemeToggle />
      </nav>
    </LiquidGlass>
  </header>

  <!-- 主视图容器 -->
  <main class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pb-24 pt-3">
    <router-view />
  </main>
</template>
