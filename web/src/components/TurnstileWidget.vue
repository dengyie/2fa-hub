<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';

const props = defineProps({
  sitekey: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['verify', 'expire', 'error']);

const container = ref(null);
let widgetId = null;
const isReady = ref(false);

function loadTurnstileScript() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const existing = document.querySelector('script[src*="turnstile/v0/api.js"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.turnstile));
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
}

async function renderWidget() {
  if (!container.value || !props.sitekey) return;
  try {
    const turnstile = await loadTurnstileScript();
    if (widgetId !== null) {
      try { turnstile.remove(widgetId); } catch { /* ignore */ }
    }
    const isDark = document.documentElement.classList.contains('dark');
    widgetId = turnstile.render(container.value, {
      sitekey: props.sitekey,
      theme: isDark ? 'dark' : 'light',
      callback: (token) => {
        emit('verify', token);
      },
      'expired-callback': () => {
        emit('expire');
      },
      'error-callback': (err) => {
        console.warn('[turnstile] widget error:', err);
        emit('error', err);
      },
    });
    isReady.value = true;
  } catch (err) {
    console.error('[turnstile] failed to render:', err);
    emit('error', err);
  }
}

function reset() {
  if (widgetId !== null && window.turnstile) {
    try {
      window.turnstile.reset(widgetId);
      emit('expire');
    } catch { /* ignore */ }
  }
}

defineExpose({ reset });

onMounted(() => {
  renderWidget();
});

onBeforeUnmount(() => {
  if (widgetId !== null && window.turnstile) {
    try {
      window.turnstile.remove(widgetId);
    } catch { /* ignore */ }
  }
});

watch(() => props.sitekey, () => {
  renderWidget();
});
</script>

<template>
  <div class="turnstile-wrapper my-2.5 flex flex-col items-center justify-center min-h-[66px]">
    <div ref="container"></div>
  </div>
</template>
