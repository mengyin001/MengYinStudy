export {};

declare global {
  interface Window {
    /** Injected by the Electron preload script; absent in a normal browser. */
    mengyinDesktop?: {
      platform: string;
      electron: string;
      chrome: string;
    };
  }
}
