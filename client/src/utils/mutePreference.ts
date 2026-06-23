const KEY = 'racehorse_muted';

export const mutePreference = {
  get(): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(KEY) === '1';
  },
  set(muted: boolean): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(KEY, muted ? '1' : '0');
  },
};
