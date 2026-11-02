<template>
  <component
    :is="as"
    ref="containerRef"
    @pointermove="handlePointerMove"
    @pointerleave="handlePointerLeave"
    :class="[
      'liquid-glass-pane group relative overflow-hidden text-zinc-900 dark:text-zinc-100 select-none transition-all duration-300',
      variantClass,
      intensityClass,
      'bg-white/70 dark:bg-zinc-900/65',
      'contrast-more:bg-white contrast-more:dark:bg-zinc-950 contrast-more:backdrop-blur-none',
      'motion-reduce:transform-none motion-reduce:transition-none',
      'border border-white/60 dark:border-white/10',
      'shadow-[inset_0_1px_1px_0_rgba(255,255,255,0.7),inset_0_-1px_1px_0_rgba(0,0,0,0.06),0_8px_32px_rgba(0,0,0,0.06)]',
      'dark:shadow-[inset_0_1px_1px_0_rgba(255,255,255,0.18),inset_0_-1px_1px_0_rgba(0,0,0,0.4),0_12px_40px_rgba(0,0,0,0.35)]',
      'hover:shadow-[inset_0_1px_1px_0_rgba(255,255,255,0.85),inset_0_-1px_1px_0_rgba(0,0,0,0.08),0_14px_44px_rgba(0,0,0,0.1)]',
      'dark:hover:shadow-[inset_0_1px_1px_0_rgba(255,255,255,0.25),inset_0_-1px_1px_0_rgba(0,0,0,0.45),0_16px_48px_rgba(0,0,0,0.45)]',
      className
    ]"
  >
    <!-- Specular refractive rim caustics sheen layer (Decoupled direct DOM manipulation for 1000Hz+ mouse tracking) -->
    <div
      v-if="interactive"
      ref="glareRef"
      aria-hidden="true"
      class="liquid-glass-glare pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-300"
      style="mix-blend-mode: overlay"
    />

    <!-- Micro-frost edge reflection ring -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 z-10 rounded-[inherit] ring-1 ring-inset ring-white/40 dark:ring-white/10"
    />

    <!-- Content slot -->
    <div class="relative z-0 h-full w-full">
      <slot />
    </div>
  </component>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  as: { type: String, default: 'div' },
  variant: {
    type: String,
    default: 'card',
    validator: (v) => ['capsule', 'card', 'panel', 'modal', 'sidebar', 'none'].includes(v),
  },
  intensity: {
    type: String,
    default: 'regular',
    validator: (v) => ['light', 'regular', 'thick'].includes(v),
  },
  interactive: { type: Boolean, default: true },
  enableTilt: { type: Boolean, default: false },
  maxTilt: { type: Number, default: 4 },
  glareOpacity: { type: Number, default: 0.35 },
  className: { type: String, default: '' },
});

const containerRef = ref(null);
const glareRef = ref(null);

const handlePointerMove = (e) => {
  // 移动端触屏滚动页面时不触发 3D Tilt 倾斜和高光抖动，确保触控滑动顺畅稳定
  if (e.pointerType === 'touch') return;
  if (!props.interactive && !props.enableTilt) return;
  const el = containerRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height || rect.width <= 0 || rect.height <= 0) return;

  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const gxPercent = ((x / rect.width) * 100).toFixed(1);
  const gyPercent = ((y / rect.height) * 100).toFixed(1);

  if (props.interactive && glareRef.value) {
    glareRef.value.style.opacity = String(props.glareOpacity);
    glareRef.value.style.background = `radial-gradient(circle at ${gxPercent}% ${gyPercent}%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.2) 35%, transparent 65%)`;
  }

  if (props.enableTilt && props.variant !== 'sidebar') {
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const ry = ((x - centerX) / centerX) * props.maxTilt;
    const rx = -((y - centerY) / centerY) * props.maxTilt;
    el.style.transform = `perspective(1000px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-1px)`;
    el.style.transition = 'transform 0.1s ease-out';
  }
};

const handlePointerLeave = () => {
  if (glareRef.value) {
    glareRef.value.style.opacity = '0';
  }
  const el = containerRef.value;
  if (el) {
    el.style.transform = '';
    el.style.transition = 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
  }
};

const variantClass = computed(() => {
  switch (props.variant) {
    case 'capsule':
      return 'rounded-full px-5 py-2 inline-flex items-center';
    case 'panel':
      return 'rounded-2xl p-4 sm:p-5 block';
    case 'modal':
      return 'rounded-3xl p-6 sm:p-8 block shadow-2xl';
    case 'sidebar':
      return 'rounded-none border-r h-full block';
    case 'none':
      return '';
    case 'card':
    default:
      return 'rounded-2xl sm:rounded-3xl p-5 sm:p-6 block';
  }
});

const intensityClass = computed(() => {
  switch (props.intensity) {
    case 'light':
      return 'backdrop-blur-md backdrop-saturate-150';
    case 'thick':
      return 'backdrop-blur-2xl backdrop-saturate-[200%]';
    case 'regular':
    default:
      return 'backdrop-blur-xl backdrop-saturate-[180%]';
  }
});
</script>
