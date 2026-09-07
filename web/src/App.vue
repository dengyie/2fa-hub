<script setup>
import { useRouter } from 'vue-router';
import { store, api } from './store.js';

const router = useRouter();
const route = router.currentRoute;

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  store.user = null;
  store.entries = [];
  router.push('/login');
}
</script>

<template>
  <header class="topbar">
    <a class="brand" href="/vault">2fa-<span>hub</span></a>
    <div class="spacer"></div>
    <template v-if="store.user">
      <a class="navlink" :class="{ active: route.path === '/vault' }" href="/vault">云端</a>
      <a class="navlink" :class="{ active: route.path === '/local' }" href="/local">本地</a>
      <a v-if="store.user.is_admin" class="navlink" :class="{ active: route.path === '/admin' }" href="/admin">管理</a>
      <a class="navlink" href="#" @click.prevent="logout">退出</a>
    </template>
    <a v-else class="navlink" :class="{ active: route.path === '/local' }" href="/local">本地模式</a>
  </header>
  <router-view />
</template>
