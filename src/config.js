// 公開版の設定。
// API_URL は Google Apps Script のウェブアプリの URL（…/exec）。
// GitHub Pages などに置いた画面は、ここへ回答や名簿を保存する。空なら、このブラウザ内だけに保存する（開発用）。
export const API_URL = 'https://script.google.com/macros/s/AKfycbyz7883Shcn2Hw37MBCOoN2H2Bl5nxTxpVV-0suSzIuzWbvTvC8U29ImnBYGVcwUQ40/exec';

// 手元（localhost など）で開いたときは API を使わず、ブラウザ内に保存する。
// ただし URL に ?api を付けると手元でも API を使う（test/api-harness.html での確認用）。
const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
export const USE_API = Boolean(API_URL) && (!isLocal || new URLSearchParams(location.search).has('api'));
