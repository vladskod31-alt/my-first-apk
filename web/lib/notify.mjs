// LIBO 2.8.7 notifications.
//
// Before 2.8.7 the app had no notifications at all: a message arriving while the app
// was in the background was simply missed. The web layer now decides *when* to notify
// and pushes through up to three channels at once:
//
//   * native  — the Android shell posts a real system notification (MainActivity
//               bridge `notifyMessage`), used inside the APK;
//   * system  — the Web Notifications API, used when LIBO runs in a browser;
//   * banner  — the in-app animated banner, shown while the app is visible but the
//               message belongs to a chat that is not open.
//
// The decision itself is a pure function so the rules can be unit-tested.

export const NOTIFY_RULE_VERSION = 1;

/**
 * @param {object} ctx
 * @param {string} ctx.chatId chat the message arrived in
 * @param {string|null} ctx.currentChatId chat open on screen (null on the welcome screen)
 * @param {boolean} ctx.visible whether the app page is currently visible
 * @param {boolean} ctx.muted per-chat mute
 * @param {boolean} ctx.enabled the global "notifications" setting
 * @returns {'none'|'banner'|'system'} where the notification should appear
 */
export function notificationTarget({ chatId, currentChatId, visible, muted = false, enabled = true }) {
  if (!enabled || muted) return 'none';
  if (!visible) return 'system';                    // background → system notification
  if (chatId === currentChatId) return 'none';      // already looking at it
  return 'banner';                                  // foreground, another chat open
}

/** Sound and haptics follow the notification unless the chat is muted. */
export function shouldSignal({ muted = false, sound = true }) {
  return !muted && sound;
}

export class Notifier {
  /**
   * @param {object} channels
   * @param {(payload:{title:string,text:string,badge:number})=>boolean} [channels.native]
   * @param {(payload:{title:string,text:string})=>boolean} [channels.system]
   * @param {(payload:{title:string,text:string,chatId:string})=>void} [channels.banner]
   * @param {()=>Promise<'granted'|'denied'|'unsupported'>} [channels.askSystem]
   */
  constructor(channels = {}) {
    this.channels = channels;
    this.badge = 0;
  }

  /** Ask for the system notification permission (Android dialog or browser prompt). */
  async ensurePermission() {
    if (this.channels.askSystem) return this.channels.askSystem();
    return 'unsupported';
  }

  /**
   * Deliver one notification. Returns the channel that was used so callers can log it.
   * @returns {'native'|'system'|'banner'|'none'}
   */
  push({ target, title, text, chatId = '' }) {
    if (target === 'none') return 'none';
    if (target === 'system') {
      this.badge += 1;
      if (this.channels.native?.({ title, text, badge: this.badge })) return 'native';
      if (this.channels.system?.({ title, text })) return 'system';
      this.badge -= 1;
      return 'none';
    }
    this.channels.banner?.({ title, text, chatId });
    return 'banner';
  }

  /** Called when the user returns to the app: the badge and system notes are cleared. */
  clear() {
    this.badge = 0;
    this.channels.clearSystem?.();
  }
}
