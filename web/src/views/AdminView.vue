<script setup>
// 管理面板：用户全量管控 + 注册开关 + 审计日志 + 服务健康
import { ref, onMounted } from 'vue';
import { api } from '../store.js';
import StatusIndicator from '../components/ui/StatusIndicator.vue';
import UiIcon from '../components/ui/UiIcon.vue';
import LiquidGlass from '../components/ui/LiquidGlass.vue';

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
const turnstileWarning = ref('');
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
    turnstileWarning.value = s.turnstile_warning || '';
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
    turnstileWarning.value = res.turnstile_warning || '';
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

const tabBtn = (t) => [
  'flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200',
  tab.value === t
    ? 'bg-blue-600 text-white shadow-[0_2px_10px_rgba(37,99,235,0.35)]'
    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-white/40 dark:hover:bg-white/5',
];
</script>

<template>
  <!-- 顶栏选项卡与健康状态胶囊 -->
  <div class="flex gap-2.5 my-4 flex-wrap items-center justify-between">
    <LiquidGlass
      variant="none"
      intensity="light"
      :interactive="false"
      className="p-1 rounded-2xl bg-white/50 dark:bg-white/5 border border-white/60 dark:border-white/10 flex items-center gap-1.5 backdrop-blur-md shadow-2xs"
    >
      <button :class="tabBtn('users')" @click="tab = 'users'"><UiIcon name="users" size="14" />用户管理</button>
      <button :class="tabBtn('audit')" @click="tab = 'audit'"><UiIcon name="paperclip" size="14" />审计日志</button>
      <button :class="tabBtn('settings')" @click="tab = 'settings'"><UiIcon name="shield" size="14" />系统设置</button>
    </LiquidGlass>

    <div class="flex items-center gap-2">
      <StatusIndicator :status="health" :ping-ms="healthPing" label="API" class="rounded-full px-3 py-1 text-xs" />
    </div>
  </div>

  <LiquidGlass
    v-if="error"
    variant="none"
    intensity="light"
    :interactive="false"
    className="rounded-2xl border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 text-xs px-4 py-3 mb-4 shadow-sm"
  >
    <div class="flex items-center gap-2">
      <UiIcon name="circle-x" size="15" />
      <span>{{ error }}</span>
    </div>
  </LiquidGlass>

  <!-- 用户管理表格 -->
  <LiquidGlass
    v-if="tab === 'users'"
    variant="card"
    intensity="regular"
    :interactive="false"
    className="overflow-x-auto p-0 border border-white/60 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.06),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_1px_rgba(255,255,255,0.15)]"
  >
    <table class="w-full text-xs sm:text-[13px]">
      <thead>
        <tr class="text-left text-zinc-500 dark:text-zinc-400 border-b border-white/40 dark:border-white/10 bg-white/30 dark:bg-white/5">
          <th class="px-4 py-3 font-semibold">ID</th>
          <th class="px-4 py-3 font-semibold">邮箱 / 昵称</th>
          <th class="px-4 py-3 font-semibold">条目</th>
          <th class="px-4 py-3 font-semibold">状态</th>
          <th class="px-4 py-3 font-semibold min-w-[260px]">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.id" class="border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/50 dark:hover:bg-white/5 transition-colors">
          <td class="px-4 py-3 font-mono text-zinc-400">{{ u.id }}</td>
          <td class="px-4 py-3">
            <div class="font-medium text-zinc-900 dark:text-zinc-100">{{ u.email }}</div>
            <div class="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 mt-0.5">
              <span>{{ u.name || '（未设置昵称）' }}</span>
              <span v-if="u.is_admin" class="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-semibold">
                <UiIcon name="shield" size="10" />管理员
              </span>
            </div>
          </td>
          <td class="px-4 py-3 font-mono">{{ u.entries }}</td>
          <td class="px-4 py-3">
            <StatusIndicator :status="u.is_active ? 'online' : 'error'" :show-dot="true" :label="u.is_active ? '正常' : '已禁用'" />
          </td>
          <td class="px-4 py-3">
            <div class="flex gap-1.5 flex-wrap">
              <button class="glass-btn px-2.5 py-1 text-xs rounded-lg" @click="toggleActive(u)">{{ u.is_active ? '禁用' : '启用' }}</button>
              <button class="glass-btn px-2.5 py-1 text-xs rounded-lg" @click="toggleAdmin(u)">{{ u.is_admin ? '取消管理' : '设为管理' }}</button>
              <button class="glass-btn px-2.5 py-1 text-xs rounded-lg" @click="resetPassword(u)">重置密码</button>
              <button class="glass-btn px-2.5 py-1 text-xs rounded-lg border-red-500/40 text-red-600 dark:text-red-400 hover:border-red-500 hover:bg-red-500/10" @click="removeUser(u)">删除</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="text-xs text-zinc-500 dark:text-zinc-400 px-4 py-3.5 border-t border-white/40 dark:border-white/10 leading-relaxed bg-white/20 dark:bg-white/2">
      禁用会立即让该用户所有会话失效；重置密码同样会作废旧会话。管理员无法禁用/删除自己与最后一个管理员。
    </p>
  </LiquidGlass>

  <!-- 审计日志表格 -->
  <LiquidGlass
    v-else-if="tab === 'audit'"
    variant="card"
    intensity="regular"
    :interactive="false"
    className="overflow-x-auto p-0 border border-white/60 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.06),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_1px_rgba(255,255,255,0.15)]"
  >
    <table class="w-full text-xs sm:text-[13px]">
      <thead>
        <tr class="text-left text-zinc-500 dark:text-zinc-400 border-b border-white/40 dark:border-white/10 bg-white/30 dark:bg-white/5">
          <th class="px-4 py-3 font-semibold">时间</th>
          <th class="px-4 py-3 font-semibold">动作</th>
          <th class="px-4 py-3 font-semibold">用户</th>
          <th class="px-4 py-3 font-semibold">详情 / IP</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in auditRows" :key="a.id" class="border-b border-white/30 dark:border-white/5 last:border-0 hover:bg-white/50 dark:hover:bg-white/5 transition-colors">
          <td class="px-4 py-2.5 whitespace-nowrap text-zinc-500 dark:text-zinc-400 font-mono text-xs">{{ fmtTime(a.created_at) }}</td>
          <td class="px-4 py-2.5">
            <span class="rounded-full border border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 px-2 py-0.5 text-[11px] font-mono shadow-2xs">
              {{ a.action }}
            </span>
          </td>
          <td class="px-4 py-2.5 font-medium text-zinc-800 dark:text-zinc-200">{{ a.user_email || '-' }}</td>
          <td class="px-4 py-2.5 text-zinc-500 dark:text-zinc-400 text-xs">{{ a.detail }} {{ a.ip && a.ip !== '::1' && a.ip !== '127.0.0.1' ? '· ' + a.ip : '' }}</td>
        </tr>
      </tbody>
    </table>
  </LiquidGlass>

  <!-- 系统设置面板 -->
  <LiquidGlass
    v-else-if="tab === 'settings'"
    variant="card"
    intensity="regular"
    :interactive="false"
    className="max-w-2xl p-6 sm:p-7 shadow-[0_8px_32px_rgba(0,0,0,0.06),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.4),inset_0_1px_1px_rgba(255,255,255,0.15)]"
  >
    <h3 class="text-base font-semibold mb-1 flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
      <div class="w-7 h-7 rounded-xl bg-blue-600/15 text-blue-600 dark:text-blue-400 flex items-center justify-center">
        <UiIcon name="shield" size="16" />
      </div>
      系统与安全设置
    </h3>
    <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-6 leading-relaxed">
      管理用户注册开放策略，以及 Cloudflare Turnstile 人机安全验证盾（防刷号与防脚本撞库）。
    </p>

    <form class="space-y-6" @submit.prevent="saveSettings">
      <!-- 注册开放策略 -->
      <LiquidGlass
        variant="none"
        intensity="light"
        :interactive="false"
        className="rounded-2xl border border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/5 p-4 shadow-sm"
      >
        <label class="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">用户注册模式</label>
        <select
          v-model="registerMode"
          class="glass-input w-full sm:w-72"
        >
          <option value="open">开放注册（允许游客自由创建账号）</option>
          <option value="invite" disabled>邀请码注册（需环境变量 INVITE_CODE）</option>
          <option value="closed">关闭注册（仅管理员可在后台手动开户）</option>
        </select>
        <p class="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2">
          设为「开放注册」后，游客可在 /login 界面切换至「注册」标签创建属于自己的云端 2FA 账户。
        </p>
      </LiquidGlass>

      <!-- Cloudflare Turnstile 设置 -->
      <LiquidGlass
        variant="none"
        intensity="light"
        :interactive="false"
        className="rounded-2xl border border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/5 p-4 space-y-4 shadow-sm"
      >
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

        <div v-if="turnstileEnabled && turnstileWarning" class="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-700 dark:text-amber-300">
          <UiIcon name="circle-x" size="14" class="mt-0.5 shrink-0" />
          <span>{{ turnstileWarning }}</span>
        </div>

        <div v-if="turnstileEnabled" class="space-y-3.5 pt-3 border-t border-white/60 dark:border-white/10">
          <div>
            <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Turnstile Sitekey (前端公钥)</label>
            <input
              v-model="turnstileSiteKey"
              type="text"
              placeholder="如 0x4AAAAAAAc2BQjPEms9tKlM 或 1x00000000000000000000AA"
              class="glass-input w-full font-mono text-xs"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Turnstile Secret Key (服务端私钥)
              <span v-if="hasTurnstileSecretKey" class="text-emerald-600 dark:text-emerald-400 ml-1 font-semibold">· 已配置密钥</span>
            </label>
            <input
              v-model="turnstileSecretKey"
              type="password"
              :placeholder="hasTurnstileSecretKey ? '留空保持现有密钥，输入新值可覆盖' : '如 0x4AAAAAAAc2BQ...' "
              class="glass-input w-full font-mono text-xs"
            />
          </div>
          <p class="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
            提示：启用验证盾需填入在 Cloudflare 控制台申请的专属 Sitekey 与 Secret Key；若启用但未配置有效密钥，系统将 fail-closed（停止放行未经验证的注册并显示警告），避免使用公开测试密钥产生虚假安全感。
          </p>
        </div>
      </LiquidGlass>

      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          :disabled="savingSettings"
          class="glass-btn-primary flex items-center gap-2 px-5 py-2.5 text-sm disabled:opacity-50"
        >
          <UiIcon v-if="savingSettings" name="loader" size="15" class="animate-spin" />
          <span>保存系统设置</span>
        </button>
        <span v-if="settingsSaved" class="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-semibold">
          <UiIcon name="check" size="14" /> 设置已成功保存
        </span>
      </div>
    </form>
  </LiquidGlass>
</template>
