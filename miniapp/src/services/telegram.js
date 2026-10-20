import WebApp from '@twa-dev/sdk';

/**
 * Thin wrapper around @twa-dev/sdk so the rest of the app never touches
 * `window.Telegram` directly. Everything the app needs from Telegram
 * (identity verification, native buttons, haptics) goes through here —
 * there is no browser navigation or external link anywhere in this app.
 */
export function initTelegram() {
  WebApp.ready();
  WebApp.expand();
  return WebApp;
}

export function getInitData() {
  return WebApp.initData;
}

export function getStartParam() {
  return WebApp.initDataUnsafe?.start_param || null;
}

export function hapticSuccess() {
  WebApp.HapticFeedback?.notificationOccurred('success');
}

export function hapticError() {
  WebApp.HapticFeedback?.notificationOccurred('error');
}

export function hapticImpact(style = 'light') {
  WebApp.HapticFeedback?.impactOccurred(style);
}

export function closeApp() {
  WebApp.close();
}

export default WebApp;
