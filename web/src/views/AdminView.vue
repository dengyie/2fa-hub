<script setup>
// 管理面板：用户全量管控 + 注册开关 + 审计日志
import { ref, onMounted } from 'vue';
import { api } from '../store.js';

const users = ref([]);
const auditRows = ref([]);
const registerMode = ref('open');
const tab = ref('users');
const error = ref('');

async function reload() {
  const [u, a] = await Promise.all([
    api('/api/admin/users'),
    api('/api/admin/audit?limit=200'),
  ]);
  users.value = u.users;
  auditRows.value = a.audit;
}

onMounted(async () => {
  try {
    await reload();
    // 读当前注册模式（settings 接口只在 PUT 时返回，这里从 bootstrap 拿）
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
</script>

<template>
  <div class="toolbar">
    <button class="btn" :class="{ primary: tab === 'users' }" @click="tab = 'users'">用户管理</button>
    <button class="btn" :class="{ primary: tab === 'audit' }" @click="tab = 'audit'">审计日志</button>
    <div class="spacer" style="flex: 1"></div>
    <select v-model="registerMode" @change="setRegisterMode" class="search" style="flex: 0; min-width: 150px">
      <option value="open">注册：开放</option>
      <option value="invite">注册：邀请码</option>
      <option value="closed">注册：关闭</option>
    </select>
  </div>

  <p class="error-text" v-if="error">{{ error }}</p>

  <div v-if="tab === 'users'" class="card-list">
    <table class="table">
      <thead>
        <tr><th>ID</th><th>邮箱 / 昵称</th><th>条目</th><th>状态</th><th style="min-width: 260px">操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.id">
          <td>{{ u.id }}</td>
          <td>
            <div>{{ u.email }}</div>
            <div class="otp-issuer">{{ u.name }} <span v-if="u.is_admin" class="pill ok">管理员</span></div>
          </td>
          <td>{{ u.entries }}</td>
          <td>
            <span class="pill" :class="u.is_active ? 'ok' : 'off'">{{ u.is_active ? '正常' : '已禁用' }}</span>
          </td>
          <td>
            <div class="actions">
              <button class="btn small" @click="patch(u, { is_active: !u.is_active })">{{ u.is_active ? '禁用' : '启用' }}</button>
              <button class="btn small" @click="patch(u, { is_admin: !u.is_admin })">{{ u.is_admin ? '取消管理' : '设为管理' }}</button>
              <button class="btn small" @click="resetPassword(u)">重置密码</button>
              <button class="btn small danger" @click="removeUser(u)">删除</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="hint">禁用会立即让该用户所有会话失效；重置密码同样会作废旧会话。管理员无法禁用/删除自己与最后一个管理员。</p>
  </div>

  <div v-else class="card-list">
    <table class="table">
      <thead>
        <tr><th>时间</th><th>动作</th><th>用户</th><th>详情 / IP</th></tr>
      </thead>
      <tbody>
        <tr v-for="a in auditRows" :key="a.id">
          <td style="white-space: nowrap">{{ a.created_at }}</td>
          <td><span class="pill">{{ a.action }}</span></td>
          <td>{{ a.user_email || '-' }}</td>
          <td class="otp-issuer">{{ a.detail }} {{ a.ip && a.ip !== '::1' && a.ip !== '127.0.0.1' ? '· ' + a.ip : '' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
