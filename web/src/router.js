import { createRouter, createWebHistory } from 'vue-router';
import LoginView from './views/LoginView.vue';
import VaultView from './views/VaultView.vue';
import LocalView from './views/LocalView.vue';
import AdminView from './views/AdminView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/vault' },
    { path: '/login', component: LoginView },
    { path: '/vault', component: VaultView },
    { path: '/local', component: LocalView },
    { path: '/admin', component: AdminView },
    { path: '/:pathMatch(.*)*', redirect: '/vault' },
  ],
});
