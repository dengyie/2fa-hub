// 智能识别 2FA 服务品牌并提供专属材质色彩与首字母/图标辅助
const BRAND_MAP = [
  { match: /github/i, name: 'GitHub', gradient: 'from-zinc-800 to-zinc-950 text-white border-zinc-700/60 shadow-[0_4px_12px_rgba(0,0,0,0.3)]', short: 'GH' },
  { match: /google/i, name: 'Google', gradient: 'from-red-500 via-amber-500 to-blue-500 text-white border-amber-400/40 shadow-[0_4px_12px_rgba(234,67,53,0.25)]', short: 'G' },
  { match: /microsoft|outlook|office365|azure/i, name: 'Microsoft', gradient: 'from-blue-600 to-indigo-700 text-white border-blue-400/40 shadow-[0_4px_12px_rgba(0,120,212,0.3)]', short: 'MS' },
  { match: /cloudflare/i, name: 'Cloudflare', gradient: 'from-orange-500 to-amber-600 text-white border-orange-400/40 shadow-[0_4px_12px_rgba(243,128,32,0.3)]', short: 'CF' },
  { match: /discord/i, name: 'Discord', gradient: 'from-indigo-500 to-purple-600 text-white border-indigo-400/40 shadow-[0_4px_12px_rgba(88,101,242,0.3)]', short: 'DC' },
  { match: /telegram/i, name: 'Telegram', gradient: 'from-sky-400 to-blue-600 text-white border-sky-300/40 shadow-[0_4px_12px_rgba(42,171,238,0.3)]', short: 'TG' },
  { match: /aws|amazon/i, name: 'AWS', gradient: 'from-amber-500 to-orange-600 text-white border-amber-400/40 shadow-[0_4px_12px_rgba(255,153,0,0.3)]', short: 'AWS' },
  { match: /openai|chatgpt/i, name: 'OpenAI', gradient: 'from-emerald-600 to-teal-800 text-white border-emerald-400/40 shadow-[0_4px_12px_rgba(16,163,127,0.3)]', short: 'AI' },
  { match: /apple|icloud/i, name: 'Apple', gradient: 'from-zinc-700 via-zinc-800 to-zinc-950 text-white border-zinc-600/50 shadow-[0_4px_12px_rgba(0,0,0,0.25)]', short: '' },
  { match: /steam/i, name: 'Steam', gradient: 'from-slate-700 to-slate-950 text-white border-slate-600/50 shadow-[0_4px_12px_rgba(23,26,33,0.3)]', short: 'ST' },
  { match: /binance/i, name: 'Binance', gradient: 'from-amber-400 to-yellow-500 text-zinc-950 border-amber-300/50 shadow-[0_4px_12px_rgba(243,186,47,0.3)]', short: 'BN' },
  { match: /twitter|x\.com/i, name: 'X / Twitter', gradient: 'from-zinc-900 to-black text-white border-zinc-700/50 shadow-[0_4px_12px_rgba(0,0,0,0.3)]', short: 'X' },
  { match: /gitlab/i, name: 'GitLab', gradient: 'from-orange-600 to-red-600 text-white border-orange-400/40 shadow-[0_4px_12px_rgba(226,67,41,0.3)]', short: 'GL' },
  { match: /notion/i, name: 'Notion', gradient: 'from-zinc-800 to-zinc-950 text-white border-zinc-700/50 shadow-[0_4px_12px_rgba(0,0,0,0.25)]', short: 'N' },
  { match: /vercel/i, name: 'Vercel', gradient: 'from-black to-zinc-900 text-white border-zinc-700/50 shadow-[0_4px_12px_rgba(0,0,0,0.3)]', short: '▲' },
  { match: /stripe/i, name: 'Stripe', gradient: 'from-indigo-600 to-blue-700 text-white border-indigo-400/40 shadow-[0_4px_12px_rgba(99,91,255,0.3)]', short: 'S' },
  { match: /proton/i, name: 'Proton', gradient: 'from-purple-600 to-indigo-700 text-white border-purple-400/40 shadow-[0_4px_12px_rgba(109,74,255,0.3)]', short: 'PM' },
];

// 自适应备选渐变方案（基于文本哈希）
const FALLBACK_GRADIENTS = [
  'from-blue-600 to-indigo-700 text-white border-blue-400/30 shadow-[0_4px_12px_rgba(37,99,235,0.25)]',
  'from-violet-600 to-purple-700 text-white border-violet-400/30 shadow-[0_4px_12px_rgba(124,58,237,0.25)]',
  'from-emerald-600 to-teal-700 text-white border-emerald-400/30 shadow-[0_4px_12px_rgba(5,150,105,0.25)]',
  'from-rose-500 to-pink-600 text-white border-rose-400/30 shadow-[0_4px_12px_rgba(225,29,72,0.25)]',
  'from-cyan-600 to-blue-700 text-white border-cyan-400/30 shadow-[0_4px_12px_rgba(8,145,178,0.25)]',
  'from-amber-500 to-orange-600 text-white border-amber-400/30 shadow-[0_4px_12px_rgba(217,119,6,0.25)]',
  'from-fuchsia-600 to-pink-700 text-white border-fuchsia-400/30 shadow-[0_4px_12px_rgba(192,38,211,0.25)]',
  'from-teal-600 to-emerald-700 text-white border-teal-400/30 shadow-[0_4px_12px_rgba(13,148,136,0.25)]',
];

function stringHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getBrandInfo(issuer = '', label = '') {
  const query = `${issuer} ${label}`.trim();
  for (const brand of BRAND_MAP) {
    if (brand.match.test(query)) {
      return {
        brandName: brand.name,
        gradient: brand.gradient,
        short: brand.short || (issuer || label || '?').slice(0, 2).toUpperCase(),
        isRecognized: true,
      };
    }
  }

  const raw = (issuer || label || '?').trim();
  const index = stringHash(raw) % FALLBACK_GRADIENTS.length;
  return {
    brandName: issuer || '未知服务',
    gradient: FALLBACK_GRADIENTS[index],
    short: raw.slice(0, 2).toUpperCase(),
    isRecognized: false,
  };
}
