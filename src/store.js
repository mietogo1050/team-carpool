// 保存処理。Google Apps Script で公開しているときはスプレッドシートへ、
// 手元で動かしているとき（開発用）はこのブラウザ内へ保存する。
import { DEFAULT_SETTINGS } from './logic.js';
import { API_URL, USE_API } from './config.js';

const KEY = 'team-carpool-v1';
const ADMIN_KEY = 'team-carpool-admin';

function normalize(state) {
  return { ...emptyState(), ...state, settings: { ...DEFAULT_SETTINGS, ...(state?.settings ?? {}) } };
}

/** このブラウザ内に保存する（開発・お試し用）。パスワードは不要 */
const localBackend = {
  remote: false,
  appUrl: () => `${location.origin}${location.pathname}`,
  needsLogin: () => false,
  login: async () => {},
  logout: () => {},
  loadAdmin: async () => loadState(),
  loadAnswer: async () => loadState(),
  saveAdmin: async (state) => saveState(state),
  saveAnswer: async (state) => saveState(state),
  replaceAll: async (state) => saveState(state),
  initialHash: async () => location.hash,
  syncHash: () => {},
};

/** Google Apps Script の関数を Promise で呼ぶ */
function gas(name, ...args) {
  return new Promise((resolve, reject) => {
    window.google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler((error) => reject(new Error(error?.message ?? String(error))))[name](...args);
  });
}

function readAdminPassword() {
  try { return localStorage.getItem(ADMIN_KEY) ?? ''; } catch { return ''; }
}

/** スプレッドシートに保存する（公開用）。管理画面は管理用パスワードが必要 */
const gasBackend = {
  remote: true,
  appUrl: () => window.APP_URL || '',
  needsLogin: () => !readAdminPassword(),
  async login(password) {
    await gas('getState', password);
    try { localStorage.setItem(ADMIN_KEY, password); } catch { /* 保存できなくても今回は使える */ }
  },
  logout() {
    try { localStorage.removeItem(ADMIN_KEY); } catch { /* なにもしない */ }
  },
  loadAdmin: async () => normalize(await gas('getState', readAdminPassword())),
  loadAnswer: async (eventId) => normalize(await gas('getAnswerData', eventId)),
  saveAdmin: (state) => gas('saveAdmin', readAdminPassword(), {
    settings: state.settings, roster: state.roster, events: state.events,
  }),
  saveAnswer: (state, eventId, answers) => gas('saveAnswer', eventId, answers),
  replaceAll: (state) => gas('replaceAll', readAdminPassword(), state),
  /** 公開URLの # 以降（LINEで送った回答ページなど） */
  initialHash: () => new Promise((resolve) => {
    // 応答がない環境でも画面が出るよう、少し待って見つからなければホームから始める
    const timer = setTimeout(() => resolve(''), 2000);
    try {
      window.google.script.url.getLocation((loc) => {
        clearTimeout(timer);
        resolve(loc?.hash ? loc.hash.replace(/^#?/, '#') : '');
      });
    } catch {
      clearTimeout(timer);
      resolve('');
    }
  }),
  /** 再読み込みしても同じ画面に戻れるよう、ブラウザのURLにも反映する */
  syncHash: (hash) => window.google.script.history.replace(null, null, hash.replace(/^#/, '')),
};

/** Apps Script の API（doPost）を呼ぶ。GitHub Pages など別の場所に置いた画面用 */
async function api(fn, ...args) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      // text/plain にすると事前確認（CORS のプリフライト）なしで送れる
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn, args }),
    });
  } catch {
    throw new Error('通信できませんでした。電波の良いところでもう一度お試しください');
  }
  if (!res.ok) throw new Error(`通信エラー（${res.status}）`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data.result;
}

const apiBackend = {
  ...gasBackend,
  appUrl: () => `${location.origin}${location.pathname}`,
  async login(password) {
    await api('getState', password);
    try { localStorage.setItem(ADMIN_KEY, password); } catch { /* 保存できなくても今回は使える */ }
  },
  loadAdmin: async () => normalize(await api('getState', readAdminPassword())),
  loadAnswer: async (eventId) => normalize(await api('getAnswerData', eventId)),
  saveAdmin: (state) => api('saveAdmin', readAdminPassword(), {
    settings: state.settings, roster: state.roster, events: state.events,
  }),
  saveAnswer: (state, eventId, answers) => api('saveAnswer', eventId, answers),
  replaceAll: (state) => api('replaceAll', readAdminPassword(), state),
  initialHash: async () => location.hash,
  syncHash: () => {},
};

export const backend = window.google?.script?.run ? gasBackend : USE_API ? apiBackend : localBackend;

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function emptyState() {
  return { settings: { ...DEFAULT_SETTINGS }, roster: [], events: [], responses: {} };
}

export function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved) return { ...emptyState(), ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings } };
  } catch {
    // 読み込めない場合は空の状態で始める
  }
  return emptyState();
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // プライベートブラウズなど保存できない環境では、表示中の間だけ保持する
  }
}

/** 操作を試すためのサンプル（架空の名前） */
export function sampleState() {
  const players = ['青木 蓮', '石田 陽翔', '上野 湊', '遠藤 悠真', '小川 朝陽', '加藤 碧', '木村 樹', '小林 律']
    .map((name, i) => ({ id: `p${i + 1}`, name, type: 'player' }));
  const parents = [
    { id: 'g1', name: '青木', type: 'parent', childIds: ['p1'] },
    { id: 'g2', name: '石田', type: 'parent', childIds: ['p2'] },
    { id: 'g3', name: '上野', type: 'parent', childIds: ['p3'] },
    { id: 'g4', name: '遠藤', type: 'parent', childIds: ['p4'] },
    { id: 'g5', name: '小川', type: 'parent', childIds: ['p5'] },
    { id: 'g6', name: '加藤', type: 'parent', childIds: ['p6'] },
    { id: 'g7', name: '木村', type: 'parent', childIds: ['p7'] },
    { id: 'g8', name: '小林', type: 'parent', childIds: ['p8'] },
    { id: 's1', name: '佐々木 監督', type: 'coach' },
    { id: 's2', name: '田村 代表', type: 'rep' },
  ];
  const ride = { attend: 'yes', out: 'ride', back: 'ride', seats: 0 };
  const responses = {
    p1: ride, p2: ride, p3: ride, p4: ride, p5: ride, p6: ride,
    p7: { attend: 'no', seats: 0 },
    g1: { attend: 'yes', father: 'yes', mother: 'no', out: 'car', back: 'car', seats: 3, driver: 'father' },
    g2: { attend: 'yes', father: 'no', mother: 'yes', out: 'car', back: 'none', seats: 2, driver: 'mother', memo: '帰りは仕事のため先に出ます' },
    g3: { attend: 'yes', father: 'yes', mother: 'no', out: 'none', back: 'car', seats: 3, driver: 'father', memo: '帰り迎えにいけます' },
    g4: { attend: 'yes', father: 'yes', mother: 'yes', out: 'ride', back: 'ride', seats: 0 },
    g5: { attend: 'no', father: 'no', mother: 'no', seats: 0 },
    g6: { attend: 'no', father: 'no', mother: 'no', seats: 0 },
    g7: { attend: 'no', father: 'no', mother: 'no', seats: 0 },
    s1: { attend: 'yes', out: 'none', back: 'none', seats: 0 },
  };
  return {
    settings: { ...DEFAULT_SETTINGS },
    roster: [...players, ...parents],
    events: [{
      id: 'sample',
      title: '練習試合（サンプル）',
      date: '2026-11-15',
      destination: '県営グラウンド',
      meetTime: '08:00',
      meetPlace: '学校正門前',
      note: '弁当と水筒を持参',
      tollOut: true,
      tollBack: true,
    }],
    responses: { sample: responses },
  };
}
