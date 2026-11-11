// 動作確認用のテストデータ。名簿はGoogleスプレッドシートから毎回最新を読み込み、回答は機械的に作る。
// 名簿・設定画面の「テストデータに置き換える」から使う。
import { DEFAULT_SETTINGS, autoAssign, allocationView, buildResultBody, legsOf, defaultLegs, maxCarsOf } from './logic.js';

// 名簿スプレッドシートの URL は、プログラムには書かず「名簿・設定」で設定する（settings.rosterSheetUrl）。

/** スプレッドシートの URL（…/d/ID/edit#gid=…）から CSV の取得先を作る。読めない URL は null */
export function sheetCsvUrl(url) {
  const id = /\/spreadsheets\/d\/([\w-]+)/.exec(url ?? '')?.[1];
  if (!id) return null;
  const gid = /[#&?]gid=(\d+)/.exec(url)?.[1];
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`;
}

// 「種別」「名前」の見出しが見つからないときの位置（B列=種別、C列=名前）
const TYPE_COL = 1;
const NAME_COL = 2;

/** 引用符・セル内改行に対応したCSV解析 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const clean = (s) => (s ?? '').replace(/[\s　]+/g, ' ').trim();
const surnameOf = (name) => name.split(' ')[0];

/** スプレッドシートの区分（B列）をアプリの区分に変換。対象外は null */
function typeOfSheet(kind, name) {
  if (kind.includes('学年') || kind === '部員') return 'player';
  if (kind === '指導部' || kind === '監督' || kind === '代表') return name.includes('代表') ? 'rep' : 'coach';
  return null;
}

/** スプレッドシートの行から名簿を作る。保護者は名字ごとに1世帯（名前は名字のみ）にまとめる */
export function rosterFromSheet(rows) {
  const header = (rows[0] ?? []).map(clean);
  const typeCol = header.indexOf('種別') >= 0 ? header.indexOf('種別') : TYPE_COL;
  const nameCol = header.indexOf('名前') >= 0 ? header.indexOf('名前') : NAME_COL;
  const players = [];
  const staff = [];
  const skipped = [];
  for (const row of rows.slice(1)) {
    const name = clean(row[nameCol]);
    const kind = clean(row[typeCol]);
    if (!name) continue;
    const type = typeOfSheet(kind, name);
    if (type === 'player') {
      const grade = { 高学年: 'high', 低学年: 'low' }[kind];
      players.push({ id: `p${players.length + 1}`, name, type, ...(grade ? { grade } : {}) });
    }
    else if (type) staff.push({ id: `s${staff.length + 1}`, name, type });
    else skipped.push(name);
  }
  const households = [];
  for (const p of players) {
    const name = surnameOf(p.name);
    let home = households.find((h) => h.name === name);
    if (!home) {
      home = { id: `g${households.length + 1}`, name, type: 'parent', childIds: [] };
      households.push(home);
    }
    home.childIds.push(p.id);
  }
  return { roster: [...players, ...households, ...staff], skipped };
}

/** 最新のスプレッドシートを読み込んで名簿を返す */
export async function fetchSheetRoster(sheetUrl) {
  const csvUrl = sheetCsvUrl(sheetUrl);
  if (!csvUrl) throw new Error('名簿スプレッドシートの URL を「名簿・設定」で設定してください');
  const res = await fetch(csvUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const result = rosterFromSheet(parseCsv(await res.text()));
  if (!result.roster.some((p) => p.type === 'player')) throw new Error('部員が見つかりません');
  return result;
}

/** 名簿の一括取り込み欄に入れるCSV */
export function rosterCsv(roster) {
  const label = { player: '部員', parent: '保護者', coach: '監督', rep: '代表' };
  const nameOf = (id) => roster.find((p) => p.id === id)?.name ?? '';
  const typeText = (p) => (p.type === 'player' && p.grade ? { high: '高学年', low: '低学年' }[p.grade] : label[p.type]);
  return ['名前,区分,子ども', ...roster.map((p) => [p.name, typeText(p), (p.childIds ?? []).map(nameOf).join('/')].join(','))].join('\n');
}

// ---- 回答パターン ----
const ride = { out: 'ride', back: 'ride' };
const H = {
  fatherBoth: { attend: 'yes', father: 'yes', mother: 'no', out: 'car', back: 'car', seats: 3, driver: 'father', memo: '' },
  motherOutOnly: { attend: 'yes', father: 'no', mother: 'yes', out: 'car', back: 'none', seats: 2, driver: 'mother', memo: '帰りは仕事のため先に出ます' },
  fatherShuttleBack: { attend: 'yes', father: 'yes', mother: 'no', out: 'none', back: 'car', seats: 3, driver: 'father', memo: '帰り迎えにいけます' },
  bothSelf: { attend: 'yes', father: 'yes', mother: 'yes', out: 'none', back: 'none', seats: 0, driver: '', memo: '' },
  kidsOnly: { attend: 'no', father: 'no', mother: 'no', seats: 0, memo: '' },
  motherBoth: { attend: 'yes', father: 'no', mother: 'yes', out: 'car', back: 'car', seats: 4, driver: 'mother', memo: '' },
  allNo: { attend: 'no', father: 'no', mother: 'no', seats: 0, memo: '家族の用事のため欠席します' },
  unanswered: null,
  motherShuttleOut: { attend: 'yes', father: 'no', mother: 'yes', out: 'car', back: 'none', seats: 2, driver: 'mother', memo: '行きだけ送ります' },
  motherBoth3: { attend: 'yes', father: 'no', mother: 'yes', out: 'car', back: 'car', seats: 3, driver: 'mother', memo: '' },
};

/** 世帯ごとにパターンを順番に割り当てて回答を作る */
function makeResponses(roster, patterns, staffAnswer) {
  const responses = {};
  roster.filter((p) => p.type === 'parent').forEach((home, i) => {
    const key = patterns[i % patterns.length];
    const answer = H[key];
    if (!answer) return;
    responses[home.id] = { ...answer };
    for (const childId of home.childIds) {
      responses[childId] = key === 'allNo' ? { attend: 'no', seats: 0 } : { attend: 'yes', ...ride, seats: 0 };
    }
  });
  roster.filter((p) => p.type === 'coach' || p.type === 'rep').forEach((p, i) => {
    responses[p.id] = staffAnswer(p, i);
  });
  return responses;
}

/** 3区間の活動用：途中の区間（mid）は行きと同じ移動にする */
function addMiddleLeg(responses) {
  for (const r of Object.values(responses)) {
    if (r.out) r.mid = r.out;
  }
  return responses;
}

export function testState({ roster }, currentSettings = {}) {
  // 道路料金や名簿スプレッドシートの URL などの設定は引き継ぐ
  const settings = { ...DEFAULT_SETTINGS, ...currentSettings };
  const firstCoach = roster.find((p) => p.type === 'coach');

  // 1. 練習試合：配車前。3区間の移動といろいろな回答パターン
  const match = {
    id: 'test-match', title: '練習試合', date: '2026-11-15', destination: '市民球場',
    meetTime: '07:30', meetPlace: '学校正門前', note: '弁当・水筒・ユニフォーム持参', carLimit: 6,
    legs: [
      { id: 'out', from: '学校正門前', to: '市民球場', toll: true },
      { id: 'mid', from: '市民球場', to: '南小学校', toll: false },
      { id: 'back', from: '南小学校', to: '学校正門前', toll: true },
    ],
  };
  const matchRes = addMiddleLeg(makeResponses(roster,
    ['fatherBoth', 'motherOutOnly', 'fatherShuttleBack', 'bothSelf', 'kidsOnly', 'motherBoth', 'allNo', 'unanswered', 'motherShuttleOut'],
    (p) => (p === firstCoach
      ? { attend: 'yes', out: 'car', back: 'car', seats: 2, driver: '', memo: '' }
      : { attend: 'yes', ...(p.type === 'rep' ? ride : { out: 'none', back: 'none' }), seats: 0, driver: '', memo: '' })));

  // 2. 公式戦：配車をLINEで共有したあとに回答が変わった状態
  const official = {
    id: 'test-official', title: '秋季大会 1回戦', date: '2026-11-22', destination: '県営運動公園 野球場',
    meetTime: '06:45', meetPlace: '学校正門前', note: '雨天の場合は前日19時に連絡します', carLimit: 7,
    legs: defaultLegs('学校正門前', '県営運動公園 野球場').map((leg) => ({ ...leg, toll: leg.id === 'out' })),
  };
  const officialPatterns = ['fatherBoth', 'kidsOnly', 'motherBoth3', 'kidsOnly', 'bothSelf', 'unanswered'];
  const officialRes = makeResponses(roster, officialPatterns,
    (p) => (p === firstCoach
      ? { attend: 'yes', out: 'car', back: 'car', seats: 3, driver: '', memo: '' }
      : { attend: 'no', seats: 0, memo: '' }));
  const legIds = legsOf(official).map((leg) => leg.id);
  official.alloc = Object.fromEntries(legIds.map((dir) => [dir, autoAssign(roster, officialRes, dir, { maxCars: maxCarsOf(official) })]));
  const views = Object.fromEntries(legIds.map((dir) => [dir, allocationView(official.alloc[dir], roster, officialRes, dir)]));
  official.sharedBody = buildResultBody(official, views, settings);
  // 共有後の変更：帰りに車を出せなくなった世帯と、遅れて回答した世帯
  const homes = roster.filter((p) => p.type === 'parent');
  const changed = homes.find((h, i) => officialPatterns[i % officialPatterns.length] === 'fatherBoth');
  if (changed) officialRes[changed.id] = { ...officialRes[changed.id], back: 'none', memo: '帰りは仕事のため配車できなくなりました' };
  const late = homes.find((h) => !officialRes[h.id]);
  if (late) {
    officialRes[late.id] = { ...H.kidsOnly, memo: '回答が遅れてすみません' };
    for (const c of late.childIds) officialRes[c] = { attend: 'yes', ...ride, seats: 0 };
  }

  // 3. 低学年だけの練習：回答なし・有料道路なし
  const practice = {
    id: 'test-practice', title: '合同練習', target: 'low', date: '2026-11-29', destination: '南小学校グラウンド',
    meetTime: '08:30', meetPlace: '学校正門前', note: '',
    legs: defaultLegs('学校正門前', '南小学校グラウンド'),
  };

  return {
    settings,
    roster,
    events: [match, official, practice],
    responses: { 'test-match': matchRes, 'test-official': officialRes, 'test-practice': {} },
  };
}
