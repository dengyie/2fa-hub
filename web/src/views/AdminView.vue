<script setup>
// 管理面板：用户全量管控 + 注册开关 + 审计日志 + 服务健康
import { ref, onMounted } from 'vue';
import { api } from '../store.js';
import StatusIndicator from '../components/ui/StatusIndicator.vue';
import UiIcon from '../components/ui/UiIcon.vue';

const users = ref([]);
const auditRows = ref([]);
const health = ref('connecting');   // online | offline
const healthPing = ref(undefined);
const registerMode = ref('open');
const tab = ref('users');
const error = ref('');

async function pingHealth() {
  const t0 = performance.now();
  try {
    await api('/api/health');
    healthPing.value = Math.round(performance.now() - t0);
    health.value = 'online';
  } catch {
    health.value = 'offline';
  }
}

async function reload() {
  const [u, a] = await Promise.all([
    api('/api/admin/users'),
    api('/api/admin/audit?limit=200'),
  ]);
  users.value = u.users;
  auditRows.value = a.audit;
}

onMounted(async () => {
  pingHealth();
  try {
    await reload();
    registerMode.value = (await api('/api/bootstrap')).register_mode;
  } catch (e) {
    error.value = e.message;
  }
});

async function patch(u, body) {
  try {
    await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body });
    await reload();
  } catch (e) {
    error.value = e.message;
    setTimeout(() => (error.value = ''), 3000);
  }
}

async function toggleActive(u) {
  const action = u.is_active ? '禁用' : '启用';
  if (!confirm(`确定${action}用户 ${u.email}？${u.is_active ? '其所有会话将立即失效。' : ''}`)) return;
  await patch(u, { is_active: !u.is_active });
}

async function toggleAdmin(u) {
  const action = u.is_admin ? '取消管理员权限' : '授予管理员权限';
  if (!confirm(`确定对 ${u.email} ${action}？`)) return;
  await patch(u, { is_admin: !u.is_admin });
}

function fmtTime(utc) {
  // SQLite datetime('now') 是 UTC，转换为本时区展示
  const d = new Date(String(utc).replace(' ', 'T') + 'Z');
  return isNaN(d) ? utc : d.toLocaleString();
}

async function resetPassword(u) {
  const pw = prompt(`为 ${u.email} 设置新密码（至少 8 位）：`);
  if (!pw) return;
  await patch(u, { password: pw });
}

async function removeUser(u) {
  if (!confirm(`彻底删除用户 ${u.email} 及其全部条目？不可恢复！`)) return;
  try {
    await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
    await reload();
  } catch (e) {
    error.value = e.message;
    setTimeout(() => (error.value = ''), 3000);
  }
}

async function setRegisterMode() {
  await api('/api/admin/settings', { method: 'PUT', body: { register_mode: registerMode.value } });
}

const tabBtn = (t) => [
  'flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm transition-colors',
  tab.value === t ? 'bg-blue-600 text-white font-semibold' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60',
];
const actionBtn = 'rounded-lg border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-xs hover:border-blue-500 transition-colors';
</script>

<template>
  <div class="flex gap-2 my-4 flex-wrap items-center">
    <button :class="tabBtn('users')" @click="tab = 'users'"><UiIcon name="users" size="15" />用户管理</button>
    <button :class="tabBtn('audit')" @click="tab = 'audit'"><UiIcon name="paperclip" size="15" />审计日志</button>
    <div class="flex-1"></div>
    <StatusIndicator :status="health" :ping-ms="healthPing" label="API" />
    <select v-model="registerMode" @change="setRegisterMode"
            class="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-2 text-sm outline-none focus:border-blue-500 transition-colors">
      <option value="open">注册：开放</option>
      <option value="invite" disabled>注册：邀请码（需 env INVITE_CODE）</option>
      <option value="closed">注册：关闭</option>
    </select>
  </div>

  <p class="text-[13px] text-red-600 dark:text-red-400 mb-3" v-if="error">{{ error }}</p>

  <div v-if="tab === 'users'" class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
    <table class="w-full text-[13px]">
      <thead>
        <tr class="text-left text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
          <th class="px-3 py-2.5 font-medium">ID</th>
          <th class="px-3 py-2.5 font-medium">邮箱 / 昵称</th>
          <th class="px-3 py-2.5 font-medium">条目</th>
          <th class="px-3 py-2.5 font-medium">状态</th>
          <th class="px-3 py-2.5 font-medium min-w-[260px]">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.id" class="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0">
          <td class="px-3 py-2.5">{{ u.id }}</td>
          <td class="px-3 py-2.5">
            <div>{{ u.email }}</div>
            <div class="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
              {{ u.name }}
              <span v-if="u.is_admin" class="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 px-1.5 py-px text-[10px]">
                <UiIcon name="shield" size="10" />管理员
              </span>
            </div>
          </td>
          <td class="px-3 py-2.5">{{ u.entries }}</td>
          <td class="px-3 py-2.5">
            <StatusIndicator :status="u.is_active ? 'online' : 'error'" :show-dot="true" :label="u.is_active ? '正常' : '已禁用'" />
          </td>
          <td class="px-3 py-2.5">
            <div class="flex gap-1 flex-wrap">
              <button :class="actionBtn" @click="toggleActive(u)">{{ u.is_active ? '禁用' : '启用' }}</button>
              <button :class="actionBtn" @click="toggleAdmin(u)">{{ u.is_admin ? '取消管理' : '设为管理' }}</button>
              <button :class="actionBtn" @click="resetPassword(u)">重置密码</button>
              <button class="rounded-lg border border-red-500/40 text-red-600 dark:text-red-400 px-2.5 py-1 text-xs hover:bg-red-500/10 transition-colors" @click="removeUser(u)">删除</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="text-xs text-zinc-500 dark:text-zinc-400 px-3 py-3 leading-relaxed">
      禁用会立即让该用户所有会话失效；重置密码同样会作废旧会话。管理员无法禁用/删除自己与最后一个管理员。
    </p>
  </div>

  <div v-else class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
    <table class="w-full text-[13px]">
      <thead>
        <tr class="text-left text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
          <th class="px-3 py-2.5 font-medium">时间</th>
          <th class="px-3 py-2.5 font-medium">动作</th>
          <th class="px-3 py-2.5 font-medium">用户</th>
          <th class="px-3 py-2.5 font-medium">详情 / IP</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in auditRows" :key="a.id" class="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0">
          <td class="px-3 py-2 whitespace-nowrap text-zinc-500 dark:text-zinc-400">{{ fmtTime(a.created_at) }}</td>
          <td class="px-3 py-2"><span class="rounded-full border border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 px-1.5 py-px text-[10px]">{{ a.action }}</span></td>
          <td class="px-3 py-2">{{ a.user_email || '-' }}</td>
          <td class="px-3 py-2 text-zinc-500 dark:text-zinc-400 text-xs">{{ a.detail }} {{ a.ip && a.ip !== '::1' && a.ip !== '127.0.0.1' ? '· ' + a.ip : '' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
