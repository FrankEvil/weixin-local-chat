<template>
  <n-modal
    :show="modelValue"
    preset="card"
    title="扫码登录"
    :style="{ width: '400px', maxWidth: 'calc(100vw - 32px)' }"
    :bordered="false"
    @update:show="emit('update:modelValue', $event)"
  >
      <n-space vertical :size="16">
        <div class="qr-box">
          <img v-if="qrImageUrl" :src="qrImageUrl" alt="登录二维码" />
          <n-qr-code
            v-else-if="qrValue"
            :value="qrValue"
            :size="220"
            color="#10233a"
            background-color="#ffffff"
          />
          <n-empty v-else description="等待生成二维码" />
        </div>

        <n-space vertical :size="8" class="qr-meta">
          <n-space align="center" :size="8">
            <n-tag size="small" :type="statusType">{{ session?.status || 'idle' }}</n-tag>
            <span class="qr-meta__text">{{ session?.error || '点击下方按钮生成二维码' }}</span>
          </n-space>
        </n-space>

        <n-space justify="end" :size="10">
          <n-button size="small" @click="emit('poll')">刷新状态</n-button>
          <n-button size="small" type="primary" :loading="busy" @click="emit('start')">生成二维码</n-button>
        </n-space>
      </n-space>
  </n-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NEmpty, NModal, NQrCode, NSpace, NTag } from 'naive-ui';

import type { LoginSessionRecord } from '@/types';

const props = defineProps<{
  modelValue: boolean;
  session: LoginSessionRecord | null;
  qrImageUrl: string;
  qrValue: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'start'): void;
  (event: 'poll'): void;
}>();

const statusType = computed(() => {
  const status = props.session?.status;
  if (status === 'confirmed') return 'success';
  if (status === 'error' || status === 'expired') return 'error';
  if (status === 'scaned') return 'warning';
  return 'info';
});
</script>

<style scoped>
.qr-box {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--card-background) 84%, white 16%);
  border: 1px solid var(--card-border);
}

.qr-box img {
  width: 100%;
  max-width: 220px;
  border-radius: 12px;
}

.qr-meta__text {
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
