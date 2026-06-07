export {};

declare global {
  interface Window {
    __COMMENTARY_PARENT_ORIGIN__?: string;
    __COMMENTARY_BUILD_ID__?: string;
    __COMMENTARY_COMMIT_SHA__?: string;
  }
}
