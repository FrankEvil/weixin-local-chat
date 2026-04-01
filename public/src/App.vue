<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-dialog-provider>
      <n-notification-provider placement="top-right" :max="3">
        <n-message-provider>
          <router-view />
        </n-message-provider>
      </n-notification-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue';
import {
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  NNotificationProvider,
  darkTheme,
} from 'naive-ui';
import type { GlobalThemeOverrides } from 'naive-ui';

import { themeControllerKey, type ThemeMode } from '@/theme';

const THEME_STORAGE_KEY = 'weixin-local-chat-theme';

const themeMode = ref<ThemeMode>((localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode) || 'light');

const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#36c2a2',
    primaryColorHover: '#4fd2b5',
    primaryColorPressed: '#2cab8e',
    infoColor: '#69aaf8',
    successColor: '#39c99b',
    warningColor: '#f3b35a',
    errorColor: '#f06d7c',
    textColorBase: '#edf4ff',
    borderRadius: '14px',
  },
  Card: {
    color: 'rgba(10, 20, 35, 0.84)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
};

const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#179c82',
    primaryColorHover: '#20b292',
    primaryColorPressed: '#13846e',
    infoColor: '#4a8fe8',
    successColor: '#1ba97b',
    warningColor: '#d28d2d',
    errorColor: '#d45767',
    textColorBase: '#122033',
    bodyColor: '#f4f8fb',
    cardColor: 'rgba(255, 255, 255, 0.92)',
    modalColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: '14px',
  },
  Card: {
    color: 'rgba(255, 255, 255, 0.9)',
    borderColor: 'rgba(17, 38, 65, 0.08)',
  },
};

const naiveTheme = computed(() => (themeMode.value === 'dark' ? darkTheme : null));
const themeOverrides = computed(() => (themeMode.value === 'dark' ? darkThemeOverrides : lightThemeOverrides));

function setTheme(mode: ThemeMode): void {
  themeMode.value = mode;
}

function toggleTheme(): void {
  themeMode.value = themeMode.value === 'dark' ? 'light' : 'dark';
}

watch(
  themeMode,
  (mode) => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  },
  { immediate: true },
);

provide(themeControllerKey, {
  mode: themeMode,
  toggleTheme,
  setTheme,
});
</script>
