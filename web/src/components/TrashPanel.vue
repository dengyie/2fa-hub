<script setup>
// 回收站面板：云端/本地共用。删除的条目在保留期内可恢复，到期自动彻底删除。
import UiIcon from './ui/UiIcon.vue';
import LiquidGlass from './ui/LiquidGlass.vue';
import { TRASH_RETENTION_DAYS } from '@shared/trash.js';

defineProps({
  entries: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  retentionDays: { type: Number, default: TRASH_RETENTION_DAYS },
});
const emit = defineEmits(['close', 'restore', 'purge', 'empty']);

function titleOf(e) {
  return e.issuer || e.label || '(未命名条目)';
}

function subtitleOf(e) {
  return e.issuer ? (e.label || '(默认主账户)') : '';
}

function daysLeftOf(e) {
  return Number.isFinite(e.days_left) ? e.days_left : TRASH_RETENTION_DAYS;
}

function expiryText(e) {
  const days = daysLeftOf(e);
  if (days <= 0) return '即将彻底删除';
  if (days === 1) return '明天彻底删除';
  return `${days} 天后彻底删除`;
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
    <div class="absolute inset-0 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm" @click="emit('close')"></div>

    <LiquidGlass
      variant="none"
      intensity="thick"
      :enableTilt="false"
      className="relative w-full max-w-lg max-h-[82vh] flex flex-col rounded-3xl border border-white/70 dark:border-white/12 bg-white/90 dark:bg-[#12141a]/90 shadow-2xl overflow-hidden"
    >
      <!-- 头部 -->
      <div class="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-3.5 border-b border-zinc-200/70 dark:border-white/10">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 shrink-0 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 flex items-center justify-center">
            <UiIcon name="trash" size="20" />
          </div>
          <div class="min-w-0">
            <h2 class="text-base font-extrabold text-zinc-900 dark:text-zinc-100">回收站</h2>
            <p class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              删除的条目保留 {{ retentionDays }} 天，到期自动彻底删除
            </p>
          </div>
        </div>
        <button
          class="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          title="关闭"
          @click="emit('close')"
        >
          <UiIcon name="x" size="16" />
        </button>
      </div>

      <!-- 列表 -->
      <div class="flex-1 overflow-y-auto px-4 sm:px-5 py-3 space-y-2">
        <div v-if="loading" class="text-center text-sm text-zinc-500 dark:text-zinc-400 py-12">
          <UiIcon name="loader" size="22" class="inline-block animate-spin text-blue-600 dark:text-blue-400" />
          <p class="text-xs text-zinc-400 mt-2">正在读取回收站…</p>
        </div>

        <template v-else-if="entries.length">
          <div
            v-for="e in entries"
            :key="e.id"
            class="flex items-center gap-3 rounded-2xl border border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/5 px-3.5 py-3"
          >
            <div class="w-9 h-9 shrink-0 rounded-xl bg-red-500/10 text-red-500 dark:text-red-400 flex items-center justify-center border border-red-500/15">
              <UiIcon name="trash" size="16" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <div class="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">{{ titleOf(e) }}</div>
                <span
                  v-if="e.type === 'hotp'"
                  class="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20"
                >HOTP</span>
              </div>
              <div class="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                <template v-if="subtitleOf(e)">{{ subtitleOf(e) }} · </template>
                <span :class="daysLeftOf(e) <= 3 ? 'text-red-500 dark:text-red-400 font-semibold' : ''">
                  {{ expiryText(e) }}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button
                class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                title="恢复到保险库"
                @click="emit('restore', e)"
              >
                <UiIcon name="restore" size="14" />恢复
              </button>
              <button
                class="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                title="彻底删除（不可恢复）"
                @click="emit('purge', e)"
              >
                <UiIcon name="circle-x" size="15" />
              </button>
            </div>
          </div>
        </template>

        <div v-else class="text-center py-12">
          <div class="w-12 h-12 rounded-2xl bg-zinc-200/50 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-2.5 text-zinc-400">
            <UiIcon name="trash" size="22" />
          </div>
          <p class="font-bold text-sm text-zinc-700 dark:text-zinc-300">回收站是空的</p>
          <p class="text-xs text-zinc-400 dark:text-zinc-500 mt-1">删除的条目会先出现在这里</p>
        </div>
      </div>

      <!-- 底部 -->
      <div class="flex items-center justify-between gap-2 px-5 sm:px-6 py-3.5 border-t border-zinc-200/70 dark:border-white/10">
        <span class="text-[11px] text-zinc-400 dark:text-zinc-500">
          {{ entries.length ? `共 ${entries.length} 个条目` : '暂无条目' }}
        </span>
        <div class="flex items-center gap-2">
          <button
            v-if="entries.length"
            class="glass-btn flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:border-red-500/40 cursor-pointer"
            @click="emit('empty')"
          >
            <UiIcon name="trash" size="13" />清空回收站
          </button>
          <button class="glass-btn-primary px-3.5 py-1.5 text-xs cursor-pointer" @click="emit('close')">
            关闭
          </button>
        </div>
      </div>
    </LiquidGlass>
  </div>
</template>
