import type { InjectionKey, Ref } from 'vue';

export type ThemeMode = 'light' | 'dark';

export interface ThemeController {
  mode: Ref<ThemeMode>;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

export const themeControllerKey: InjectionKey<ThemeController> = Symbol('theme-controller');
