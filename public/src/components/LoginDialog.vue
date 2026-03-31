<template>
  <n-modal
    :show="modelValue"
    preset="card"
    title="扫码登录"
    class="login-modal"
    :bordered="false"
    size="huge"
    @update:show="emit('update:modelValue', $event)"
  >
    <n-space vertical :size="20">
      <n-alert type="info" :show-icon="false">
        生成二维码后请用手机微信扫码，并在确认后保持窗口打开直到状态变为已登录。重复扫码即可继续新增微信账号。
      </n-alert>

      <div class="qr-panel">
        <div class="qr-box">
          <img v-if="qrImageUrl" :src="qrImageUrl" alt="登录二维码" />
          <n-qr-code
            v-else-if="qrValue"
            :value="qrValue"
            :size="280"
            color="#10233a"
            background-color="#ffffff"
          />
          <n-empty v-else description="等待生成二维码" />
        </div>
        <n-space vertical :size="8" class="qr-meta">
          <n-tag :type="statusType">{{ session?.status || 'idle' }}</n-tag>
          <span class="qr-meta__text">{{ session?.error || '点击下方按钮生成新的登录二维码。' }}</span>
          <span class="qr-meta__text">每确认一次登录，左侧账号面板就会新增一个微信账号，可随时切换。</span>
          <a v-if="session?.qrcodeUrl" :href="session.qrcodeUrl" target="_blank" rel="noreferrer">打开原始二维码地址</a>
        </n-space>
      </div>

      <n-space justify="end">
        <n-button @click="emit('poll')">刷新状态</n-button>
        <n-button type="primary" :loading="busy" @click="emit('start')">生成二维码</n-button>
      </n-space>
    </n-space>
  </n-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NAlert, NButton, NEmpty, NModal, NQrCode, NSpace, NTag } from 'naive-ui';

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
.login-modal {
  width: min(720px, calc(100vw - 32px));
}

.qr-panel {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 20px;
  align-items: center;
}

.qr-box {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  border-radius: 20px;
  background: color-mix(in srgb, var(--card-background) 84%, white 16%);
  border: 1px solid var(--card-border);
}

.qr-box img {
  width: 100%;
  max-width: 280px;
  border-radius: 16px;
}

.qr-meta {
  color: var(--text-primary);
}

.qr-meta__text {
  color: var(--text-secondary);
  line-height: 1.6;
}

.qr-meta a {
  color: var(--link-color);
  text-decoration: none;
}

.qr-meta a:hover {
  text-decoration: underline;
}

@media (max-width: 768px) {
  .qr-panel {
    grid-template-columns: 1fr;
  }
}
</style>
