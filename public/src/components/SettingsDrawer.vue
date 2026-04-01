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

          <n-tab-pane name="notify" tab="通知服务">
            <n-form label-placement="top" :model="draft">
              <n-form-item label="默认通知目标">
                <n-select
                  :value="selectedNotifyTarget"
                  :options="notifyTargetOptions"
                  placeholder="从已有账号/会话中选择"
                  clearable
                  @update:value="handleNotifyTargetChange"
                />
              </n-form-item>
              <n-form-item label="通知 Token">
                <n-input :value="draft.notifyToken" type="textarea" :autosize="{ minRows: 2, maxRows: 3 }" readonly />
              </n-form-item>
              <n-space justify="space-between" align="center">
                <n-text depth="3">通知接口无需登录，但必须携带 Bearer Token。</n-text>
                <n-button tertiary :loading="tokenRotating" @click="emit('regenerate-notify-token')">重新生成 Token</n-button>
              </n-space>
              
              <n-divider />
              
              <n-card size="small" :bordered="false">
                <template #header>
                  <n-space align="center" :size="8">
                    <span>📖</span>
                    <span>使用说明</span>
                  </n-space>
                </template>
                <n-space vertical :size="12">
                  <n-text depth="3">通过 HTTP POST 请求发送通知到微信：</n-text>
                  <n-code language="bash" :code="notifyCurlExample" />
                  <n-text depth="3">支持的参数：</n-text>
                  <n-ul>
                    <n-li><n-text code>title</n-text> - 可选，通知标题（如：告警、错误、成功）</n-li>
                    <n-li><n-text code>content</n-text> - 可选，通知内容</n-li>
                    <n-li><n-text code>text</n-text> - 可选，通知内容（与 content 二选一）</n-li>
                    <n-li><n-text code>accountId</n-text> - 可选，指定发送账号（不填使用默认）</n-li>
                  </n-ul>
                  <n-alert type="info" :show-icon="false">
                    标题会自动添加对应 emoji：告警⚠️、错误❌、成功✅、信息ℹ️
                  </n-alert>
                </n-space>
              </n-card>
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

          <n-tab-pane name="security" tab="安全设置">
            <n-space vertical :size="16">
              <n-alert type="warning" :show-icon="false">
                修改密码后，当前和其他浏览器会话都会重新登录。
              </n-alert>
              <n-form label-placement="top">
                <n-form-item label="当前密码">
                  <n-input v-model:value="passwordForm.currentPassword" type="password" show-password-on="click" />
                </n-form-item>
                <n-form-item label="新密码">
                  <n-input v-model:value="passwordForm.newPassword" type="password" show-password-on="click" />
                </n-form-item>
                <n-form-item label="确认新密码">
                  <n-input v-model:value="passwordForm.confirmPassword" type="password" show-password-on="click" />
                </n-form-item>
              </n-form>
              <n-space justify="end">
                <n-button :loading="passwordChanging" @click="handleChangePassword">修改密码</n-button>
              </n-space>
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
import { computed, reactive, watch } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NCode,
  NDivider,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NInput,
  NLi,
  NSelect,
  NSpace,
  NTabPane,
  NTabs,
  NTag,
  NText,
  NUl,
  useMessage,
} from 'naive-ui';

import type { AccountRecord, AppConfig, RuntimeDiagnostics } from '@/types';

const props = defineProps<{
  modelValue: boolean;
  config: AppConfig;
  accounts: AccountRecord[];
  diagnostics: RuntimeDiagnostics | null;
  saving: boolean;
  validating: boolean;
  passwordChanging: boolean;
  tokenRotating: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'save', value: AppConfig): void;
  (event: 'validate', value: AppConfig): void;
  (event: 'refresh-diagnostics'): void;
  (event: 'change-password', value: { currentPassword: string; newPassword: string }): void;
  (event: 'regenerate-notify-token'): void;
}>();

const message = useMessage();

const modeOptions: Array<{ label: string; value: AppConfig['openclawMode'] }> = [
  { label: 'auto（优先自动检测）', value: 'auto' },
  { label: 'local（宿主机 CLI）', value: 'local' },
  { label: 'docker（容器）', value: 'docker' },
];

const draft = reactive<AppConfig>({ ...props.config });
const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const notifyTargetOptions = computed(() => props.accounts
  .filter((account) => account.latestPeerId)
  .map((account) => ({
    label: `${account.displayName || account.accountId} · ${account.latestConversationTitle || account.latestPeerId}`,
    value: account.accountId,
    peerId: account.latestPeerId,
  })));

const selectedNotifyTarget = computed(() => draft.defaultNotifyAccountId || null);

const notifyCurlExample = computed(() => {
  const token = draft.notifyToken || '<your-token>';
  return `curl -X POST http://localhost:3000/api/notify \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "告警", "content": "CPU 使用率过高"}'`;
});

watch(
  () => props.config,
  (value) => {
    Object.assign(draft, value);
  },
  { deep: true, immediate: true },
);

watch(
  () => [props.accounts, draft.defaultNotifyAccountId] as const,
  () => {
    if (!draft.defaultNotifyAccountId) {
      return;
    }
    const target = notifyTargetOptions.value.find((item) => item.value === draft.defaultNotifyAccountId);
    if (target?.peerId) {
      draft.defaultNotifyPeerId = target.peerId;
    }
  },
  { deep: true, immediate: true },
);

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function handleNotifyTargetChange(value: string | null): void {
  if (!value) {
    draft.defaultNotifyAccountId = '';
    draft.defaultNotifyPeerId = '';
    return;
  }
  const target = notifyTargetOptions.value.find((item) => item.value === value);
  draft.defaultNotifyAccountId = value;
  draft.defaultNotifyPeerId = target?.peerId ?? '';
}

function handleChangePassword(): void {
  if (!passwordForm.currentPassword.trim() || !passwordForm.newPassword.trim()) {
    message.warning('请填写当前密码和新密码');
    return;
  }
  if (passwordForm.newPassword.trim().length < 8) {
    message.warning('新密码至少 8 位');
    return;
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    message.warning('两次输入的新密码不一致');
    return;
  }
  emit('change-password', {
    currentPassword: passwordForm.currentPassword,
    newPassword: passwordForm.newPassword,
  });
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
