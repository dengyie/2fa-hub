<template>
  <div
    :class="[
      'inline-flex items-center p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/80 dark:border-zinc-700/80 text-xs font-medium text-zinc-500 dark:text-zinc-400 select-none',
      className
    ]"
    role="group"
    aria-label="Theme toggle"
  >
    <button
      type="button"
      @click="applyTheme('auto')"
      :class="[
        'flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all',
        mode === 'auto'
          ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs font-semibold'
          : 'hover:text-zinc-900 dark:hover:text-zinc-100'
      ]"
      title="Follow System/Time"
    >
      <UiIcon name="monitor" size="13" />
      <span>Auto</span>
    </button>

    <button
      type="button"
      @click="applyTheme('light')"
      :class="[
        'flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all',
        mode === 'light'
          ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs font-semibold'
          : 'hover:text-zinc-900 dark:hover:text-zinc-100'
      ]"
      title="Light Mode"
    >
      <UiIcon name="sun" size="13" />
      <span>Light</span>
    </button>

    <button
      type="button"
      @click="applyTheme('dark')"
      :class="[
        'flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all',
        mode === 'dark'
          ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs font-semibold'
          : 'hover:text-zinc-900 dark:hover:text-zinc-100'
      ]"
      title="Dark Mode"
    >
      <UiIcon name="moon" size="13" />
      <span>Dark</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import UiIcon from './UiIcon.vue';

export type ThemeMode = 'auto' | 'light' | 'dark';

const props = withDefaults(
  defineProps<{
    storageKey?: string;
    className?: string;
  }>(),
  {
    storageKey: 'mango-theme',
    className: ''
  }
);

const emit = defineEmits<{
  (e: 'change', mode: ThemeMode, resolved: 'light' | 'dark'): void;
}>();

const mode = ref<ThemeMode>('auto');

const resolveTheme = (m: ThemeMode): 'light' | 'dark' => {
  if (m === 'light' || m === 'dark') return m;
  const hour = new Date().getHours();
  const isNight =
    (typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches) ||
    hour >= 19 ||
    hour < 7;
  return isNight ? 'dark' : 'light';
};

const applyTheme = (nextMode: ThemeMode) => {
  const resolved = resolveTheme(nextMode);
  document.documentElement.dataset.theme = nextMode;
  document.documentElement.dataset.resolvedTheme = resolved;
  document.documentElement.style.colorScheme = resolved;
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  mode.value = nextMode;
  localStorage.setItem(props.storageKey, nextMode);
  emit('change', nextMode, resolved);
};

onMounted(() => {
  const saved = (localStorage.getItem(props.storageKey) as ThemeMode) || 'auto';
  applyTheme(saved);
});
</script>
