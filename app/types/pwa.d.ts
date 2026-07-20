export {};

declare global {
  interface Window {
    deferredPWAInstall?: {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
    };
  }
}
