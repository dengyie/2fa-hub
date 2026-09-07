import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import { store, initSession } from './store.js';
import './main.css';

// 启动时静默探测会话，决定路由可用性
await initSession();

const app = createApp(App);
app.use(router);

// 路由守卫：/vault /admin 需要登录态（必须在 mount 触发首次导航之前注册）
router.beforeEach((to) => {
  if ((to.path === '/vault' || to.path === '/admin') && !store.user) return '/login';
  if (to.path === '/admin' && !store.user?.is_admin) return '/vault';
  if (to.path === '/login' && store.user) return '/vault';
  return true;
});

app.mount('#app');
