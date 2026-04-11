// src/modules/notification.types.ts

export interface NotificationPayload {
  title: string;
  message: string;
  subtitle?: string;
  appIcon?: string;
}

export const TERMINAL_BUNDLE_IDS: Record<string, string> = {
  Apple_Terminal: 'com.apple.Terminal',
  'iTerm.app': 'com.googlecode.iterm2',
  WezTerm: 'com.github.wez.wezterm',
  Alacritty: 'org.alacritty',
  kitty: 'net.kovidgoyal.kitty',
  ghostty: 'com.mitchellh.ghostty',
};

export const DEFAULT_BUNDLE_ID = 'com.apple.Terminal';
