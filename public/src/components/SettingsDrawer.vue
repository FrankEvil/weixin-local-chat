<template>
  <n-drawer :show="modelValue" width="460" placement="right" @update:show="emit('update:modelValue', $event)">
    <n-drawer-content title="设置与运行诊断" closable>
      <n-space vertical :size="20">
        <n-alert type="info" :show-icon="false">
          这里统一管理微信网关、工作目录和 OpenClaw 运行方式。保存前可先做校验。
        </n-alert>

        <n-tabs type="line" animated>
          <n-tab-pane name="gateway" tab="网关设置">
            <n-form label-placement="top" :model="draft">
              <n-form-item label="baseUrl">
                <n-input v-model:value="draft.baseUrl" placeholder="https://ilinkai.weixin.qq.com" />
              </n-form-item>
              <n-form-item label="cdnBaseUrl">
                <n-input v-model:value="draft.cdnBaseUrl" placeholder="https://novac2c.cdn.weixin.qq.com/c2c" />
              </n-form-item>
              <n-form-item label="botType">
                <n-input v-model:value="draft.botType" placeholder="3" />
              </n-form-item>
            </n-form>
          </n-tab-pane>

          <n-tab-pane name="agent" tab="Agent 工作区">
            <n-form label-placement="top" :model="draft">
              <n-form-item label="defaultWorkspace">
                <n-input v-model:value="draft.defaultWorkspace" placeholder="默认工作目录" />
              </n-form-item>
              <n-form-item label="codexWorkspace">
                <n-input v-model:value="draft.codexWorkspace" placeholder="留空继承 defaultWorkspace" />
              </n-form-item>
              <n-form-item label="claudeWorkspace">
                <n-input v-model:value="draft.claudeWorkspace" placeholder="留空继承 defaultWorkspace" />
              </n-form-item>
            </n-form>
          </n-tab-pane>

          <n-tab-pane name="openclaw" tab="OpenClaw">
            <n-form label-placement="top" :model="draft">
              <n-form-item label="openclawMode">
                <n-select
                  v-model:value="draft.openclawMode"
                  :options="modeOptions"
                />
              </n-form-item>
              <n-form-item label="openclawWorkspace">
                <n-input v-model:value="draft.openclawWorkspace" placeholder="local=宿主机目录；docker=容器目录" />
              </n-form-item>
              <n-form-item label="openclawCommand">
                <n-input v-model:value="draft.openclawCommand" placeholder="留空自动检测 PATH 或 ~/.openclaw/bin/openclaw" />
              </n-form-item>
              <n-form-item label="openclawDataDir">
                <n-input v-model:value="draft.openclawDataDir" placeholder="留空自动推断" />
              </n-form-item>
              <n-form-item label="openclawContainer">
                <n-input v-model:value="draft.openclawContainer" placeholder="docker 模式容器名" />
              </n-form-item>
            </n-form>
          </n-tab-pane>

          <n-tab-pane name="diagnostics" tab="运行诊断">
            <n-space vertical>
              <div class="diagnostics-meta">
                <span>默认工作目录：{{ diagnostics?.defaultWorkspace || draft.defaultWorkspace || '-' }}</span>
                <span>最近检查：{{ diagnostics?.checkedAt ? formatTime(diagnostics.checkedAt) : '未检查' }}</span>
              </div>
              <n-grid :cols="1" :x-gap="12" :y-gap="12">
                <n-grid-item v-for="item in diagnostics?.providers || []" :key="item.provider">
                  <n-card size="small" class="diagnostics-card">
                    <template #header>
                      <n-space justify="space-between" align="center">
                        <strong>{{ item.provider }}</strong>
                        <n-tag :type="item.available ? 'success' : 'warning'" size="small">
                          {{ item.available ? '可用' : '待修复' }}
                        </n-tag>
                      </n-space>
                    </template>
                    <n-space vertical :size="6">
                      <span>命令：{{ item.command || '-' }}</span>
                      <span>工作目录：{{ item.workspace || '-' }}</span>
                      <span v-if="item.container">容器：{{ item.container }}</span>
                      <span v-if="item.dataDir">数据目录：{{ item.dataDir }}</span>
                      <n-text depth="3">{{ item.details }}</n-text>
                    </n-space>
                  </n-card>
                </n-grid-item>
              </n-grid>
            </n-space>
          </n-tab-pane>
        </n-tabs>

        <n-space justify="end">
          <n-button tertiary @click="emit('refresh-diagnostics')">重新诊断</n-button>
          <n-button :loading="validating" @click="emit('validate', { ...draft })">校验配置</n-button>
          <n-button type="primary" :loading="saving" @click="emit('save', { ...draft })">保存设置</n-button>
        </n-space>
      </n-space>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NInput,
  NSelect,
  NSpace,
  NTabPane,
  NTabs,
  NTag,
  NText,
} from 'naive-ui';

import type { AppConfig, RuntimeDiagnostics } from '@/types';

const props = defineProps<{
  modelValue: boolean;
  config: AppConfig;
  diagnostics: RuntimeDiagnostics | null;
  saving: boolean;
  validating: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'save', value: AppConfig): void;
  (event: 'validate', value: AppConfig): void;
  (event: 'refresh-diagnostics'): void;
}>();

const modeOptions: Array<{ label: string; value: AppConfig['openclawMode'] }> = [
  { label: 'auto（优先自动检测）', value: 'auto' },
  { label: 'local（宿主机 CLI）', value: 'local' },
  { label: 'docker（容器）', value: 'docker' },
];

const draft = reactive<AppConfig>({ ...props.config });

watch(
  () => props.config,
  (value) => {
    Object.assign(draft, value);
  },
  { deep: true, immediate: true },
);

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
</script>

<style scoped>
.diagnostics-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: rgba(226, 232, 255, 0.72);
}

.diagnostics-card {
  background: rgba(255, 255, 255, 0.02);
}
</style>
