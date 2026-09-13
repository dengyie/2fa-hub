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

const turnstileEnabled = ref(true);
const turnstileSiteKey = ref('');
const turnstileSecretKey = ref('');
const hasTurnstileSecretKey = ref(false);
const settingsSaved = ref(false);
const savingSettings = ref(false);

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

async function loadSettings() {
  try {
    const s = await api('/api/admin/settings');
    registerMode.value = s.register_mode || 'open';
    turnstileEnabled.value = Boolean(s.turnstile_enabled);
    turnstileSiteKey.value = s.turnstile_sitekey || '';
    hasTurnstileSecretKey.value = Boolean(s.has_turnstile_secretkey);
  } catch (err) {
    console.warn('Failed to load admin settings:', err);
  }
}

async function saveSettings() {
  error.value = '';
  savingSettings.value = true;
  settingsSaved.value = false;
  try {
    const payload = {
      register_mode: registerMode.value,
      turnstile_enabled: turnstileEnabled.value,
      turnstile_sitekey: turnstileSiteKey.value,
    };
    if (turnstileSecretKey.value.trim()) {
      payload.turnstile_secretkey = turnstileSecretKey.value.trim();
    }
    const res = await api('/api/admin/settings', { method: 'PUT', body: payload });
    registerMode.value = res.register_mode;
    turnstileEnabled.value = Boolean(res.turnstile_enabled);
    turnstileSiteKey.value = res.turnstile_sitekey;
    hasTurnstileSecretKey.value = Boolean(res.has_turnstile_secretkey);
    turnstileSecretKey.value = '';
    settingsSaved.value = true;
    setTimeout(() => (settingsSaved.value = false), 3000);
  } catch (err) {
    error.value = err.message;
  } finally {
    savingSettings.value = false;
  }
}

onMounted(async () => {
  pingHealth();
  try {
    await reload();
    await loadSettings();
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
    <button :class="tabBtn('settings')" @click="tab = 'settings'"><UiIcon name="shield" size="15" />系统设置</button>
    <div class="flex-1"></div>
    <StatusIndicator :status="health" :ping-ms="healthPing" label="API" />
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

  <div v-else-if="tab === 'audit'" class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
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

  <div v-else-if="tab === 'settings'" class="max-w-2xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-7 shadow-xs">
    <h3 class="text-base font-semibold mb-1 flex items-center gap-2">
      <UiIcon name="shield" size="18" class="text-blue-600 dark:text-blue-400" />
      系统与安全设置
    </h3>
    <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-6 leading-relaxed">
      管理用户注册开放策略，以及 Cloudflare Turnstile 人机安全验证盾（防刷号与防脚本撞库）。
    </p>

    <form class="space-y-6" @submit.prevent="saveSettings">
      <!-- 注册开放策略 -->
      <div class="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/50 p-4">
        <label class="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">用户注册模式</label>
        <select
          v-model="registerMode"
          class="w-full sm:w-72 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
        >
          <option value="open">开放注册（允许游客自由创建账号）</option>
          <option value="invite" disabled>邀请码注册（需环境变量 INVITE_CODE）</option>
          <option value="closed">关闭注册（仅管理员可在后台手动开户）</option>
        </select>
        <p class="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1.5">
          设为「开放注册」后，游客可在 /login 界面切换至「注册」标签创建属于自己的云端 2FA 账户。
        </p>
      </div>

      <!-- Cloudflare Turnstile 设置 -->
      <div class="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/50 p-4 space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Cloudflare Turnstile 人机验证盾</div>
            <div class="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">注册时强制完成 CF 智能验证，杜绝批量机器脚本注册</div>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" v-model="turnstileEnabled" class="sr-only peer" />
            <div class="w-11 h-6 bg-zinc-300 peer-focus:outline-none rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        <div v-if="turnstileEnabled" class="space-y-3.5 pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60">
          <div>
            <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Turnstile Sitekey (前端公钥)</label>
            <input
              v-model="turnstileSiteKey"
              type="text"
              placeholder="如 0x4AAAAAAAc2BQjPEms9tKlM 或 1x00000000000000000000AA"
              class="w-full font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div>
            <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
              Turnstile Secret Key (服务端私钥)
              <span v-if="hasTurnstileSecretKey" class="text-emerald-600 dark:text-emerald-400 ml-1 font-semibold">· 已配置密钥</span>
            </label>
            <input
              v-model="turnstileSecretKey"
              type="password"
              :placeholder="hasTurnstileSecretKey ? '留空保持现有密钥，输入新值可覆盖' : '如 0x4AAAAAAAc2BQ...' "
              class="w-full font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <p class="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
            提示：留空未配置时系统默认启用 Cloudflare 官方「始终通过」公开测试密钥（1x00...AA），可即开即用体验验证盾；在生产环境下建议填入在 Cloudflare 控制台申请的专属 Sitekey 与 Secret Key。
          </p>
        </div>
      </div>

      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          :disabled="savingSettings"
          class="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 text-sm transition-colors disabled:opacity-50"
        >
          <UiIcon v-if="savingSettings" name="loader" size="15" class="animate-spin" />
          <span>保存系统设置</span>
        </button>
        <span v-if="settingsSaved" class="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
          <UiIcon name="check" size="14" /> 设置已成功保存
        </span>
      </div>
    </form>
  </div>
</template>
