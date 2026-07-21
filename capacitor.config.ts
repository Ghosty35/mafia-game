import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ghosty35.hustlersway',
  appName: 'Hustler\'s Way',
  webDir: 'dist',
  server: {
    url: 'https://hustlersways-git-master-ghost-stars.vercel.app',
    cleartext: true
  }
};

export default config;