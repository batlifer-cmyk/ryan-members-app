import { authentication, currentMember } from 'wix-members-frontend';
import {
  loadQuietlyFluentState,
  saveQuietlyFluentState,
} from 'backend/quietlyFluent.web';

const HTML_COMPONENT_ID = '#quietlyFluentHtml';
let initialized = false;
let saveChain = Promise.resolve();

$w.onReady(() => {
  const appFrame = $w(HTML_COMPONENT_ID);

  appFrame.onMessage((event) => {
    const message = event.data || {};

    if (message.type === 'QF_READY' || message.type === 'QF_RELOAD') {
      initializeApp(appFrame);
      return;
    }

    if (message.type === 'QF_SAVE_STATE') {
      saveChain = saveChain
        .then(() => saveQuietlyFluentState({
          state: message.state,
          unitId: message.unitId,
          appVersion: message.appVersion,
        }))
        .then((result) => {
          appFrame.postMessage({
            type: 'QF_SAVED',
            savedAt: result.savedAt || new Date().toISOString(),
          });
        })
        .catch((error) => {
          console.error('Quietly Fluent save failed', error);
          appFrame.postMessage({
            type: 'QF_ERROR',
            message: error?.message || '학습 기록 저장에 실패했습니다.',
          });
        });
    }
  });
});

async function initializeApp(appFrame) {
  if (initialized) {
    initialized = false;
  }

  try {
    let member = await currentMember.getMember();
    if (!member) {
      await authentication.promptLogin({ mode: 'login', modal: true });
      member = await currentMember.getMember();
    }

    if (!member) {
      appFrame.postMessage({ type: 'QF_AUTH_REQUIRED' });
      return;
    }

    const result = await loadQuietlyFluentState();
    initialized = true;
    appFrame.postMessage({
      type: 'QF_INIT',
      member: result.member,
      isStaff: Boolean(result.isStaff),
      state: result.state || null,
      savedAt: result.savedAt || null,
      appVersion: result.appVersion,
    });
  } catch (error) {
    console.error('Quietly Fluent initialization failed', error);
    appFrame.postMessage({
      type: 'QF_ERROR',
      message: error?.message || '학습앱을 불러오지 못했습니다.',
    });
  }
}
