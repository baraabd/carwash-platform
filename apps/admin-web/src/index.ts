/** W01 technical browser boot; no business capability or approved UI port. */
export const WEB_RUNTIME = Object.freeze({
  app: 'admin-web',
  stage: 'foundation-only',
  businessReady: false,
});

const root = document.getElementById('app');
if (!root) throw new Error('BOOT_ROOT_MISSING');
root.dataset.runtimeStage = WEB_RUNTIME.stage;
root.dataset.businessReady = String(WEB_RUNTIME.businessReady);
root.setAttribute('aria-busy', 'false');
