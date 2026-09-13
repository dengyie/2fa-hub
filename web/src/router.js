import { createRouter, createWebHistory } from 'vue-router';
import { store } from './store.js';
import LoginView from './views/LoginView.vue';
import VaultView from './views/VaultView.vue';
import LocalView from './views/LocalView.vue';
import AdminView from './views/AdminView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: (to) => (store.user ? { path: '/vault', query: to.query } : { path: '/local', query: to.query }),
    },
    { path: '/login', component: LoginView },
    { path: '/vault', component: VaultView },
    { path: '/local', component: LocalView },
    { path: '/admin', component: AdminView },
    // 快捷直达深链：/2fa/<secret> 或 /otp/<secret> 自动重定向至免登本地工作台并填入密钥
    {
      path: '/2fa/:secret(.*)',
      redirect: (to) => ({ path: '/local', query: { secret: to.params.secret, ...to.query } }),
    },
    {
      path: '/otp/:secret(.*)',
      redirect: (to) => ({ path: '/local', query: { secret: to.params.secret, ...to.query } }),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
