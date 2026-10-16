import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.racehorse.dominoes',
  appName: 'Racehorse Dominoes',
  webDir: 'dist',
  backgroundColor: '#0A0E17',
  // The native bridge otherwise prints every plugin call and its returned payload to stdout, including release builds
  // (verified on a Release simulator build). For the Preferences plugin that payload is the stored session
  // (access + refresh token), so nothing may be logged.
  loggingBehavior: 'none',
  ios: {
    backgroundColor: '#0A0E17',
    // Native scrolling stays ON: with it off, touch scrolling inside the page
    // (feeds, leaderboards) stops working on device. The document itself is
    // locked in CSS instead (native-landscape.css: fixed, non-overflowing root),
    // so there is nothing at page level to pan or rubber-band.
    scrollEnabled: true,
  },
};

export default config;
