// Cloudflare Turnstile 人机验证模块
import { config } from './config.js';
import { getSetting } from './db.js';

export function getTurnstileConfig() {
  const enabledStr = getSetting('turnstile_enabled', null);
  const enabled = enabledStr !== null
    ? (enabledStr === '1' || enabledStr === 'true')
    : config.turnstileEnabled;

  let siteKey = getSetting('turnstile_sitekey', config.turnstileSiteKey);
  let secretKey = getSetting('turnstile_secretkey', config.turnstileSecretKey);

  // 若启用 Turnstile 但尚未配置自定义密钥，回退至 Cloudflare 官方「始终通过」测试公私钥即开即用
  if (enabled && (!siteKey || !secretKey)) {
    siteKey = siteKey || '1x00000000000000000000AA';
    secretKey = secretKey || '1x0000000000000000000000000000000AA';
  }

  return {
    enabled: Boolean(enabled && siteKey && secretKey),
    siteKey: siteKey || '',
    secretKey: secretKey || '',
  };
}

/**
 * 校验前端 Turnstile 响应 token
 * @param {string} token - 前端 Turnstile 回传的 response token
 * @param {string} [remoteip] - 客户端真实 IP (可选)
 * @returns {Promise<{ success: boolean, errorCodes?: string[] }>}
 */
export async function verifyTurnstile(token, remoteip = '') {
  const { enabled, secretKey } = getTurnstileConfig();
  if (!enabled) {
    return { success: true };
  }

  if (!token || typeof token !== 'string') {
    return { success: false, errorCodes: ['missing-input-response'] };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', token);
    if (remoteip) {
      formData.append('remoteip', remoteip);
    }

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': '2fa-hub-server/1.0',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn(`[turnstile] HTTP error from siteverify: ${res.status}`);
      return { success: false, errorCodes: [`http-${res.status}`] };
    }

    const data = await res.json();
    return {
      success: Boolean(data.success),
      errorCodes: Array.isArray(data['error-codes']) ? data['error-codes'] : [],
    };
  } catch (err) {
    console.error('[turnstile] verification request failed:', err.message);
    return { success: false, errorCodes: ['network-error'] };
  }
}
