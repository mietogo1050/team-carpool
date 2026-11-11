import * as L from './logic.js';
import { backend, newId, sampleState } from './store.js';
import { testState, fetchSheetRoster, rosterCsv } from './testdata.js';

let state = { settings: { ...L.DEFAULT_SETTINGS }, roster: [], events: [], responses: {} };
const app = document.getElementById('app');
const ui = { who: '', saved: false, armed: '', toast: '', importText: '', importRows: null, loading: true, error: '', loadedFor: '' };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const findEvent = (id) => state.events.find((e) => e.id === id);
const responsesOf = (id) => state.responses[id] ?? {};
const byType = (type) => state.roster.filter((p) => p.type === type);
const players = () => byType('player');
const typesInUse = () => L.PERSON_TYPES.filter((t) => byType(t.id).length > 0);
const groupLabel = (t) => (t.id === 'parent' ? '保護者（世帯）' : t.label);
const childrenOf = (household) => players().filter((c) => (household.childIds ?? []).includes(c.id));
const unlinkedPlayers = () => {
  const linked = new Set(byType('parent').flatMap((p) => p.childIds ?? []));
  return players().filter((p) => !linked.has(p.id));
};
const routeId = () => location.hash.replace(/^#\/?/, '').split('/')[1];
/** 活動の対象（全員・高学年・低学年）に絞った名簿 */
const rosterOf = (event) => L.eventRoster(event, state.roster);
const answerUrl = (id) => `${backend.appUrl()}#/a/${id}`;
const routeName = () => location.hash.replace(/^#\/?/, '').split('/')[0];

/** 画面を描き直して、管理データ（設定・名簿・活動）を保存する */
function commit() {
  render();
  persist();
}

// 保存は順番に行い、読み込みは保存が終わってから行う（古いデータで上書きしないため）
let pendingSave = Promise.resolve();

function queueSave(save) {
  pendingSave = pendingSave
    .then(save)
    .catch((err) => showToast(`保存できませんでした：${err.message}`));
  return pendingSave;
}

function persist() {
  return queueSave(() => backend.saveAdmin(state));
}

/**
 * 画面に必要なデータを読み込む。回答ページは公開用（その活動だけ）、
 * それ以外は管理用（パスワードが必要）のデータを読む。
 */
async function loadForRoute() {
  const [route, id] = location.hash.replace(/^#\/?/, '').split('/');
  ui.loading = true;
  render();
  await pendingSave;
  try {
    if (route === 'a') state = await backend.loadAnswer(id);
    else if (!backend.needsLogin()) state = await backend.loadAdmin();
    ui.error = '';
    ui.loadedFor = route === 'a' ? `a:${id}` : 'admin';
  } catch (err) {
    if (/パスワード/.test(err.message)) backend.logout();
    else ui.error = err.message;
  }
  ui.loading = false;
  render();
}

function viewsOf(event) {
  const responses = responsesOf(event.id);
  return Object.fromEntries(L.legsOf(event).map((leg) => [
    leg.id, L.allocationView(event.alloc?.[leg.id], rosterOf(event), responses, leg.id),
  ]));
}

function top(title = true) {
  const publicPage = backend.remote && routeName() === 'a';
  return `<header class="top">
    ${publicPage ? '<span class="brand">チーム配車</span>' : '<a class="brand" href="#/">チーム配車</a>'}
    ${title ? '<a class="btn small" href="#/roster">名簿・設定</a>' : ''}
  </header>`;
}

function eventInfo(e) {
  return `<h1>${esc(e.title)}</h1>
  <dl class="info">
    <dt>日付</dt><dd>${esc(L.formatDate(e.date))}</dd>
    ${e.target && e.target !== 'all' ? `<dt>対象</dt><dd>${esc(L.targetLabel(e.target))}</dd>` : ''}
    <dt>行先</dt><dd>${esc(e.destination)}</dd>
    ${Number(e.carLimit) ? `<dt>台数</dt><dd>${Number(e.carLimit)}台まで（道具車1台を含む）</dd>` : ''}
    <dt>集合</dt><dd>${esc(e.meetTime)} ${esc(e.meetPlace)}</dd>
    ${legsInfo(e)}
    ${e.note ? `<dt>連絡</dt><dd>${esc(e.note)}</dd>` : ''}
  </dl>`;
}

/** 3区間以上、または経路が入っている活動は移動区間を表示する */
function legsInfo(e) {
  const legs = L.legsOf(e);
  if (legs.length <= 2 && !legs.some(L.legRoute)) return '';
  return `<dt>移動</dt><dd>${legs.map((leg, i) => esc(L.legLabel(legs, i))).join('<br>')}</dd>`;
}

// ---- ホーム ----
function renderHome() {
  const events = [...state.events].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const empty = events.length === 0 && state.roster.length === 0;
  return `${top()}
  <a class="btn primary block" href="#/new" style="margin-bottom:12px">＋ 新しい活動を作成</a>
  ${empty ? `<section class="card">
    <h2>はじめに</h2>
    <p class="muted">「名簿・設定」で部員と保護者を登録してから活動を作成します。まず操作を試す場合は、サンプルデータを読み込めます。</p>
    <button class="btn" data-act="sample">サンプルデータを読み込む</button>
  </section>` : ''}
  ${events.map((e) => {
    const respondents = rosterOf(e).filter(L.isAdult);
    const answered = respondents.filter((p) => responsesOf(e.id)[p.id]).length;
    return `<section class="card">
      <div class="row between"><b>${esc(L.formatDate(e.date))} ${esc(e.title)}${e.target && e.target !== 'all' ? ` <span class="tag">${esc(L.targetLabel(e.target))}</span>` : ''}</b>
      <span class="muted">回答 ${answered}/${respondents.length}</span></div>
      <p class="muted" style="margin:0 0 8px">${esc(e.destination)}　集合 ${esc(e.meetTime)}</p>
      <div class="row">
        <a class="btn small primary" href="#/m/${e.id}">集計・配車</a>
        <a class="btn small" href="#/a/${e.id}">回答ページ</a>
        <a class="btn small" href="#/edit/${e.id}">編集</a>
      </div>
    </section>`;
  }).join('')}`;
}

// ---- 活動の作成・編集 ----
function renderEventForm(e) {
  const v = e ?? {};
  const legs = e ? L.legsOf(e) : L.defaultLegs();
  return `${top()}
  <form class="card" data-form="event" data-id="${esc(e?.id ?? '')}">
    <h1>${e ? '活動を編集' : '新しい活動'}</h1>
    <label class="field">活動名<input type="text" name="title" required value="${esc(v.title)}" placeholder="例：練習試合"></label>
    <label class="field">日付<input type="date" name="date" required value="${esc(v.date)}"></label>
    <fieldset>
      <legend>対象</legend>
      <div class="choices three">
        ${L.TARGETS.map((t) => radio('target', t.id, t.label, v.target || 'all')).join('')}
      </div>
      <p class="hint" style="margin-top:6px">学年を選ぶと、その学年のお子さんがいる世帯だけがアンケートに出ます（学年は名簿で設定）。</p>
    </fieldset>
    <label class="field">行先<input type="text" name="destination" required value="${esc(v.destination)}"></label>
    <label class="field">集合時間<input type="time" name="meetTime" required value="${esc(v.meetTime)}"></label>
    <label class="field">集合場所<input type="text" name="meetPlace" value="${esc(v.meetPlace)}"></label>
    <label class="field">台数制限（道具車1台を含む）
      <input type="number" name="carLimit" min="1" max="50" inputmode="numeric" value="${esc(v.carLimit ?? '')}" placeholder="制限なし">
      <span class="hint" style="display:block;margin-top:4px">会場に停められる台数です。自動配車は、道具車1台を除いた台数で車を選びます。</span>
    </label>
    <label class="field">連絡事項<textarea name="note" rows="2">${esc(v.note)}</textarea></label>
    <fieldset>
      <legend>移動区間</legend>
      <p class="hint">ふだんは行き・帰りの2区間です。途中で別の場所へ移動する日は区間を追加します。有料道路は区間ごとに片道一律 ${state.settings.tollFee}円です。</p>
      <div data-legs>${legs.map(legRow).join('')}</div>
      <button type="button" class="btn small" data-act="add-leg">＋ 区間を追加</button>
    </fieldset>
    <div class="row">
      <button class="btn primary">保存</button>
      <a class="btn" href="#/">戻る</a>
      ${e ? armedButton(`del-event:${e.id}`, '削除', 'もう一度押すと削除') : ''}
    </div>
  </form>`;
}

function legRow(leg, index) {
  return `<div class="leg-row" data-leg="${esc(leg.id)}">
    <span class="leg-no">${index + 1}</span>
    <input type="text" data-leg-from value="${esc(leg.from)}" placeholder="出発地" aria-label="出発地">
    <span class="leg-arrow">→</span>
    <input type="text" data-leg-to value="${esc(leg.to)}" placeholder="到着地" aria-label="到着地">
    <div class="leg-foot">
      <label class="check"><input type="checkbox" data-leg-toll ${leg.toll ? 'checked' : ''}> 有料道路を使う</label>
      <button type="button" class="btn small danger" data-act="del-leg">削除</button>
    </div>
  </div>`;
}

/** 区間の番号を振り直し、1区間だけのときは削除できないようにする */
function renumberLegs(container) {
  const rows = [...container.querySelectorAll('[data-leg]')];
  rows.forEach((row, i) => {
    row.querySelector('.leg-no').textContent = i + 1;
    row.querySelector('[data-act="del-leg"]').disabled = rows.length === 1;
  });
}

function armedButton(key, label, armedLabel) {
  return `<button type="button" class="btn danger small" data-act="arm" data-key="${esc(key)}">${ui.armed === key ? armedLabel : label}</button>`;
}

// ---- 回答ページ（LINEで配るページ） ----
function radio(name, value, label, current) {
  return `<label class="choice"><input type="radio" name="${name}" value="${value}" ${current === value ? 'checked' : ''}> ${label}</label>`;
}

/** 父・母の参加。どちらか1つだけ選べ、選ばなければ不参加 */
function roleCheck(name, value, label, current) {
  return `<label class="choice"><input type="checkbox" name="${name}" value="${value}" data-role ${current === value ? 'checked' : ''}> ${label}</label>`;
}

function roleValue(form, role) {
  return form.querySelector(`input[name="${role}"]:checked`)?.value ?? 'no';
}

function renderChildFields(child, r, legs) {
  const prefix = `c-${child.id}`;
  const moveField = (leg, i) => `<div data-child-dir="${esc(leg.id)}">
    <div data-dir-choice>
      <p class="sub-legend">${esc(L.legName(legs, i))}の移動</p>
      <div class="choices two">
        ${radio(`${prefix}-${leg.id}`, 'ride', '乗せてほしい', r[leg.id])}
        ${radio(`${prefix}-${leg.id}`, 'none', '配車は不要', r[leg.id])}
      </div>
    </div>
  </div>`;
  return `<fieldset class="child-block" data-child="${child.id}">
    <legend>${esc(child.name)}</legend>
    <div class="choices two">
      ${radio(`${prefix}-attend`, 'yes', '参加', r.attend)}
      ${radio(`${prefix}-attend`, 'no', '不参加', r.attend)}
    </div>
    <div data-child-moves>${legs.map(moveField).join('')}</div>
  </fieldset>`;
}

function renderAnswerForm(e, person, r) {
  const isHousehold = person.type === 'parent';
  const legs = L.legsOf(e);
  const hasCar = legs.some((leg) => r[leg.id] === 'car');
  const dirField = (leg, i) => `<fieldset>
    <legend>${esc(L.legName(legs, i))}の移動</legend>
    ${L.legRoute(leg) ? `<p class="hint">${esc(L.legRoute(leg))}${leg.toll ? '（有料道路あり）' : ''}</p>` : ''}
    <div class="choices">
      ${radio(leg.id, 'car', '配車できる', r[leg.id])}
      ${isHousehold ? '' : radio(leg.id, 'ride', '配車できない（乗せてほしい）', r[leg.id])}
      ${radio(leg.id, 'none', '自分で行く', r[leg.id])}
    </div>
  </fieldset>
  ${i === 0 && legs.length > 2 ? `<button type="button" class="btn small same-legs" data-act="same-legs">以降の区間も${esc(L.legName(legs, 0))}と同じにする</button>` : ''}`;
  const children = isHousehold ? childrenOf(person) : [];
  const responses = responsesOf(routeId());
  return `<form data-form="answer" data-legs="${esc(legs.map((leg) => leg.id).join(','))}">
    ${isHousehold ? `<fieldset>
      <legend>親の参加</legend>
      <p class="hint">参加する方を選んでください（両方可・選ばない方は不参加）</p>
      <div class="choices two">
        ${L.PARENT_ROLES.map((role) => roleCheck(role.id, 'yes', role.label, ['yes', 'shuttle'].includes(r[role.id]) ? 'yes' : '')).join('')}
      </div>
    </fieldset>` : `<fieldset>
      <legend>参加しますか？</legend>
      <div class="choices two">
        ${radio('attend', 'yes', '参加', r.attend)}
        ${radio('attend', 'no', '不参加', r.attend)}
      </div>
    </fieldset>`}
    <div data-transport>
      ${legs.map(dirField).join('')}
      <div data-car>
        ${isHousehold ? `<fieldset>
          <legend>運転手</legend>
          <div class="choices two">
            ${radio('driver', 'father', '父', r.driver)}
            ${radio('driver', 'mother', '母', r.driver)}
          </div>
        </fieldset>` : ''}
        <label class="field">乗車可能人数（運転手と自分の子どもを除いた数）
          <input type="number" name="seats" min="0" max="9" value="${esc(hasCar ? r.seats : 3)}"></label>
      </div>
    </div>
    ${children.length ? `<h3>部員</h3>${children.map((c) => renderChildFields(c, responses[c.id] ?? {}, legs)).join('')}` : ''}
    <label class="field">メモ（任意）
      <textarea name="memo" rows="2" maxlength="200" placeholder="例）途中抜けます">${esc(r.memo)}</textarea>
    </label>
    <p class="error hidden" data-error></p>
    <button class="btn primary block">回答を送信</button>
  </form>`;
}

function renderAnswer(e) {
  const roster = rosterOf(e);
  const person = roster.find((p) => p.id === ui.who);
  const r = person ? responsesOf(e.id)[person.id] ?? {} : {};
  const options = (list) => list.map((p) => (
    `<option value="${p.id}" ${p.id === ui.who ? 'selected' : ''}>${esc(p.name)}</option>`
  )).join('');
  return `${top(false)}
  <section class="card">${eventInfo(e)}</section>
  <section class="card">
    ${ui.saved ? '<div class="notice">回答を受け付けました。変更するときは、もう一度送信してください。</div>' : ''}
    <label class="field">世帯を選んでください
      <select data-change="who">
        <option value="">選択してください</option>
        ${L.PERSON_TYPES.filter(L.isAdultType).filter((t) => t.id === 'parent' || canEnterStaff()).map((t) => {
          const list = roster.filter((p) => p.type === t.id);
          return list.length ? `<optgroup label="${groupLabel(t)}">${options(list)}</optgroup>` : '';
        }).join('')}
      </select>
    </label>
    ${person ? renderAnswerForm(e, person, r) : ''}
  </section>`;
}

/** 監督・代表の回答は管理者が入力する（公開の回答ページでは世帯だけを出す） */
function canEnterStaff() {
  return !backend.needsLogin();
}

// ---- 集計・配車 ----
const moveLabel = { car: '配車可', ride: '同乗希望', none: '自分で行く' };

function renderTally(e) {
  const responses = responsesOf(e.id);
  const roster = rosterOf(e);
  const count = (list, test) => list.filter((p) => test(responses[p.id])).length;
  const memos = roster.filter((p) => responses[p.id]?.memo);
  const stats = (title, list, key, withShuttle) => `<h3>${title}</h3>
    <div class="stats">
      <div class="stat"><b>${count(list, (r) => r?.[key] === 'yes')}</b><span>参加</span></div>
      ${withShuttle ? `<div class="stat"><b>${count(list, (r) => r?.[key] === 'shuttle')}</b><span>送迎のみ</span></div>` : ''}
      <div class="stat"><b>${count(list, (r) => r?.[key] === 'no')}</b><span>不参加</span></div>
      <div class="stat"><b>${count(list, (r) => !r?.[key])}</b><span>未回答</span></div>
    </div>`;
  const block = (type, list) => (type.id === 'parent'
    ? L.PARENT_ROLES.map((role) => stats(`保護者（${role.label}）`, list, role.id, false)).join('')
    : stats(groupLabel(type), list, 'attend', false));
  const legs = L.legsOf(e);
  const span = legs.length + 1;
  const row = (p) => {
    const r = responses[p.id];
    if (!r) return `<tr><td>${esc(p.name)}</td><td class="none" colspan="${span}">未回答</td></tr>`;
    if (r.attend === 'no' && !r.father) return `<tr><td>${esc(p.name)}</td><td class="no" colspan="${span}">不参加</td></tr>`;
    if (r.attend === 'no') {
      return `<tr><td>${esc(p.name)}</td><td class="no" colspan="${span}">親は不参加</td></tr>`;
    }
    const carDetail = [L.DRIVER_LABEL[r.driver], `${r.seats}人`].filter(Boolean).join('・');
    const cell = (dir) => `${moveLabel[r[dir]] ?? '-'}${r[dir] === 'car' ? `(${carDetail})` : ''}`;
    const attendCell = p.type === 'parent' && r.father
      ? L.PARENT_ROLES.filter((role) => r[role.id] !== 'no').map((role) => `${role.label}:${L.ATTEND_LABEL[r[role.id]]}`).join(' ')
      : L.ATTEND_LABEL[r.attend];
    return `<tr><td>${esc(p.name)}</td><td>${attendCell}</td>${legs.map((leg) => `<td>${cell(leg.id)}</td>`).join('')}</tr>`;
  };
  return `<section class="card">
    <div class="row between"><h2>回答状況</h2><button class="btn small" data-act="refresh">最新の回答を読み込む</button></div>
    ${L.PERSON_TYPES.map((t) => [t, roster.filter((p) => p.type === t.id)]).filter(([, list]) => list.length).map(([t, list]) => block(t, list)).join('')}
    ${memos.length ? `<h3>メモ</h3>${memos.map((p) => `<div class="list-item"><span><b>${esc(p.name)}</b><br>${esc(responses[p.id].memo)}</span></div>`).join('')}` : ''}
    <details>
      <summary>一人ずつの回答を見る</summary>
      <div class="table-wrap"><table>
        <thead><tr><th>名前</th><th>参加</th>${legs.map((leg, i) => `<th>${esc(L.legName(legs, i))}</th>`).join('')}</tr></thead>
        <tbody>${roster.map(row).join('')}</tbody>
      </table></div>
    </details>
  </section>`;
}

const adultSeats = (person) => L.seatCount(person, responsesOf(routeId())[person.id]);

function renderRider(view, dir, person, currentDriverId, { stale = false, ownChild = false } = {}) {
  const options = view.cars.map((c) => (
    `<option value="${c.driver.id}" ${c.driver.id === currentDriverId ? 'selected' : ''}>${esc(L.carName(c.driver))}</option>`
  )).join('');
  return `<div class="rider">
    <span>${esc(person.name)}${L.isAdult(person) ? ` <span class="tag">大人${adultSeats(person) > 1 ? `${adultSeats(person)}人` : ''}</span>` : ''}${ownChild ? ' <span class="tag">お子さん</span>' : ''}${stale ? ' <span class="tag warn">回答変更あり</span>' : ''}</span>
    <select data-change="move" data-dir="${dir}" data-rider="${person.id}" aria-label="${esc(person.name)}の乗車先">
      <option value="">未割当</option>${options}
    </select>
  </div>`;
}

function renderDirection(e, view, legs, index) {
  const leg = legs[index];
  const dir = leg.id;
  const hasToll = leg.toll;
  const cars = view.cars.map((car) => {
    const toll = hasToll ? L.tollForCar(car, state.settings.tollFee, state.settings) : null;
    return `<div class="car ${car.over ? 'over' : ''}">
      <div class="car-head">
        <span>${esc(L.carName(car.driver))}${car.driverLabel ? ` <span class="tag">運転手：${car.driverLabel}</span>` : ''}</span>
        <span>
          ${car.driverStale ? '<span class="tag warn">車の提供が取消</span>' : ''}
          ${car.over ? '<span class="tag warn">定員超過</span>' : ''}
          ${car.used}/${car.seats}人
          <button type="button" class="btn small" data-act="car-off" data-dir="${esc(dir)}" data-driver="${car.driver.id}">使わない</button>
        </span>
      </div>
      ${car.riders.map((r) => renderRider(view, dir, r.person, car.driver.id, {
        stale: r.stale,
        ownChild: r.ownChild,
      })).join('')
        || '<p class="muted" style="margin:0">同乗者なし</p>'}
      ${toll?.payers.length ? `<div class="toll-line">部員${toll.payers.length}人で ${state.settings.tollFee}円 → 1人 ${toll.share}円</div>` : ''}
    </div>`;
  }).join('');
  const count = L.carCount(e, view);
  return `<h3>${esc(L.legName(legs, index))}${L.legRoute(leg) ? ` <span class="muted">${esc(L.legRoute(leg))}</span>` : ''}${hasToll ? ' <span class="tag">有料道路あり</span>' : ''}</h3>
    ${count.limit ? `<p class="car-count ${count.over ? 'warn' : ''}">台数 ${count.used}/${count.limit}台（道具車1台を含む）${count.over ? '：制限を超えています' : ''}</p>` : ''}
    ${cars || '<p class="muted">使う車がありません。</p>'}
    ${view.off.length ? `<div class="car off">
      <div class="car-head"><span>使わない車</span><span class="muted">${view.off.length}台</span></div>
      ${view.off.map((d) => `<div class="rider"><span>${esc(L.carName(d))}</span>
        <button type="button" class="btn small" data-act="car-on" data-dir="${esc(dir)}" data-driver="${d.id}">使う</button></div>`).join('')}
      <p class="muted" style="margin:4px 0 0">この車の家族は、ほかの車に乗る人として配車します。</p>
    </div>` : ''}
    ${view.unassigned.length ? `<div class="car pool">
      <div class="car-head"><span>未割当</span><span class="tag warn">${view.unassigned.length}人</span></div>
      ${view.unassigned.map((p) => renderRider(view, dir, p, '')).join('')}
    </div>` : ''}`;
}

function renderToll(e, views) {
  const legs = L.legsOf(e);
  const tolled = legs.map((leg, i) => ({ leg, name: L.legName(legs, i) })).filter((x) => x.leg.toll);
  if (!tolled.length) return '';
  const summary = L.tollSummary(e, views, state.settings);
  return `<section class="card">
    <h2>道路料金</h2>
    ${summary.players.length === 0 ? '<p class="muted">配車を作成すると計算されます。</p>' : `
    <div class="table-wrap"><table>
      <thead><tr><th>部員</th>${tolled.map((x) => `<th class="num">${esc(x.name)}</th>`).join('')}<th class="num">合計</th></tr></thead>
      <tbody>${summary.players.map((r) => `<tr><td>${esc(r.person.name)}</td>
        ${tolled.map((x) => `<td class="num">${r[x.leg.id] ?? 0}円</td>`).join('')}<td class="num"><b>${r.total}円</b></td></tr>`).join('')}</tbody>
    </table></div>
    <h3>運転者の受け取り</h3>
    ${summary.drivers.map((r) => `<div class="list-item"><span>${esc(r.person.name)}</span><b>${r.total}円</b></div>`).join('')}`}
  </section>`;
}

function warningsOf(e, views) {
  const warnings = [];
  const legs = L.legsOf(e);
  for (const [i, leg] of legs.entries()) {
    const label = L.legName(legs, i);
    const v = views[leg.id];
    if (v.unassigned.length) warnings.push(`${label}：未割当が${v.unassigned.length}人います`);
    if (v.cars.some((c) => c.over)) warnings.push(`${label}：定員を超えている車があります`);
    if (L.carCount(e, v).over) warnings.push(`${label}：台数制限を超えています`);
    if (v.cars.some((c) => c.driverStale || c.riders.some((r) => r.stale))) {
      warnings.push(`${label}：配車後に回答が変わった人がいます`);
    }
  }
  return warnings;
}

function renderManage(e) {
  const views = viewsOf(e);
  const announcement = L.buildAnnouncement(e, answerUrl(e.id));
  const result = L.buildResultText(e, views, state.settings);
  const warnings = warningsOf(e, views);
  const legs = L.legsOf(e);
  const autoKey = `auto:${e.id}`;
  const needsConfirm = Boolean(e.alloc) && ui.armed !== autoKey;
  return `${top()}
  <section class="card">${eventInfo(e)}
    <div class="row" style="margin-top:8px"><a class="btn small" href="#/edit/${e.id}">編集</a><a class="btn small" href="#/a/${e.id}">回答ページを開く</a></div>
  </section>
  <section class="card">
    <h2>1. お知らせとアンケートをLINEで送る</h2>
    <pre class="preview">${esc(announcement)}</pre>
    <div class="row">
      <a class="btn line" target="_blank" rel="noopener" href="${esc(L.lineShareUrl(announcement))}">LINEで送る</a>
      <button class="btn" data-act="copy" data-text="${esc(announcement)}">コピー</button>
    </div>
  </section>
  ${renderTally(e)}
  <section class="card">
    <h2>2. 配車を決める</h2>
    <button class="btn primary block" data-act="auto" data-id="${e.id}">
      ${!e.alloc ? '配車案を自動作成' : needsConfirm ? '配車案を作り直す' : 'もう一度押すと手動の変更を破棄して作り直します'}
    </button>
    ${e.alloc ? legs.map((leg, i) => renderDirection(e, views[leg.id], legs, i)).join('') : '<p class="muted">回答が集まったら押してください。作成後に一人ずつ乗る車を変更できます。</p>'}
  </section>
  ${e.alloc ? renderToll(e, views) : ''}
  ${e.alloc ? `<section class="card">
    <h2>3. 配車結果をLINEで共有</h2>
    ${warnings.map((w) => `<div class="notice warn">${esc(w)}</div>`).join('')}
    <pre class="preview">${esc(result)}</pre>
    <div class="row">
      <a class="btn line" target="_blank" rel="noopener" data-act="shared" data-id="${e.id}" href="${esc(L.lineShareUrl(result))}">LINEで送る</a>
      <button class="btn" data-act="copy" data-shared="${e.id}" data-text="${esc(result)}">コピー</button>
    </div>
  </section>` : ''}`;
}

// ---- 名簿・設定 ----
function renderImportPreview(rows) {
  const addCount = rows.filter((r) => r.status === 'new').length;
  const skipCount = rows.length - addCount;
  const statusLabel = { new: '登録', duplicate: '飛ばす', error: 'エラー' };
  return `<h3>取り込み内容の確認</h3>
    <p class="muted">登録 ${addCount}人${skipCount ? `／登録しない行 ${skipCount}件` : ''}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>行</th><th>名前</th><th>区分</th><th>結果</th><th>メモ</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${r.line}</td><td>${esc(r.name)}</td><td>${esc(L.typeLabel(r.type) || r.typeText)}</td>
        <td class="${r.status === 'new' ? '' : 'no'}">${statusLabel[r.status]}</td>
        <td>${r.childNames.length && !r.note ? `お子さん：${esc(r.childNames.join('、'))}` : esc(r.note)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="row" style="margin-top:12px">
      <button class="btn primary" data-act="import-apply" ${addCount ? '' : 'disabled'}>${addCount}人を登録</button>
      <button class="btn" data-act="import-cancel">やめる</button>
    </div>`;
}

function renderImport() {
  return `<section class="card">
    <h2>一括取り込み</h2>
    <p class="muted">Excelの表をコピーして貼り付けるか、CSVファイルを選びます。列は左から「名前」「区分」「お子さんの名前（保護者のみ）」です。区分は 部員・保護者・監督・代表 のいずれかです。部員は「高学年」「低学年」と書くと学年も登録されます。保護者は1世帯1行で登録し、お子さんが複数のときは「、」で区切ります。</p>
    <pre class="preview">名前,区分,お子さん
青木 蓮,部員
青木,保護者,青木 蓮
佐々木 一郎,監督
田村 花子,代表</pre>
    <label class="field">CSVファイル<input type="file" accept=".csv,.txt,text/csv,text/plain" data-change="import-file"></label>
    <label class="field">または貼り付け<textarea id="import-text" rows="6">${esc(ui.importText)}</textarea></label>
    <button class="btn" data-act="import-check">内容を確認</button>
    ${ui.importRows ? (ui.importRows.length ? renderImportPreview(ui.importRows) : '<p class="error" style="margin-top:12px">取り込める行がありません</p>') : ''}
  </section>`;
}

async function readImportFile(file) {
  ui.importText = L.decodeRosterFile(await file.arrayBuffer());
  ui.importRows = L.parseRoster(ui.importText, state.roster);
  render();
}

function unlinkedNotice() {
  const list = unlinkedPlayers();
  return list.length
    ? `<div class="notice warn">世帯が未設定の部員がいます（アンケートに回答できません）：${esc(list.map((p) => p.name).join('、'))}</div>`
    : '';
}

function gradeSelect(p) {
  return `<select class="grade-select" data-change="grade" data-id="${p.id}" aria-label="${esc(p.name)}の学年">
    <option value="">学年未設定</option>
    ${L.GRADES.map((g) => `<option value="${g.id}" ${p.grade === g.id ? 'selected' : ''}>${g.label}</option>`).join('')}
  </select>`;
}

function renderRoster() {
  const childOptions = (parent) => players().map((c) => `
    <label class="check"><input type="checkbox" data-change="child" data-parent="${parent.id}" value="${c.id}" ${(parent.childIds ?? []).includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>
  `).join('');
  const removeBtn = (p) => armedButton(`del-person:${p.id}`, '削除', 'もう一度押す');
  return `${top(false)}
  <section class="card">
    <h1>名簿</h1>
    <p class="muted">アンケートは世帯単位です。保護者は「青木」のように名字で1世帯1件登録し、お子さんを設定してください。</p>
    <div id="unlinked">${unlinkedNotice()}</div>
    <form data-form="person" class="row" style="align-items:flex-end">
      <label class="field" style="flex:2 1 180px;margin:0">名前<input type="text" name="name" required></label>
      <label class="field" style="flex:1 1 100px;margin:0">区分
        <select name="type">${L.PERSON_TYPES.map((t) => `<option value="${t.id}">${t.label}</option>`).join('')}</select>
      </label>
      <button class="btn primary">追加</button>
    </form>
    ${L.PERSON_TYPES.map((t) => `<h3>${groupLabel(t)}（${byType(t.id).length}${t.id === 'parent' ? '世帯' : '人'}）</h3>
      ${byType(t.id).map((p) => (t.id === 'parent' ? `<div class="parent-block">
        <div class="list-item"><span>${esc(p.name)}</span>${removeBtn(p)}</div>
        <details><summary>お子さんを設定（${childrenOf(p).length}人）</summary>${childOptions(p) || '<p class="muted">部員を先に登録してください</p>'}</details>
      </div>` : `<div class="list-item"><span>${esc(p.name)}</span><span class="row">${t.id === 'player' ? gradeSelect(p) : ''}${removeBtn(p)}</span></div>`)).join('') || '<p class="muted">未登録</p>'}`).join('')}
  </section>
  ${renderImport()}
  <section class="card">
    <h2>設定</h2>
    <label class="field">有料道路の料金（片道）
      <input type="number" min="0" step="10" data-change="tollFee" value="${esc(state.settings.tollFee)}">
    </label>
    <label class="check"><input type="checkbox" data-change="driverChildPays" ${state.settings.driverChildPays ? 'checked' : ''}> 運転者の子も道路料金の割り勘に含める</label>
    ${backend.remote ? '<button class="btn small" data-act="logout" style="margin-top:12px">この端末の管理画面からログアウト</button>' : ''}
  </section>
  <section class="card">
    <h2>テスト用データ</h2>
    <p class="muted">名簿スプレッドシート（種別・名前の列）から最新の名簿を読み込み、架空の回答を付けた活動3件に置き換えます。保護者は名字ごとに1世帯としてまとめます。いまの名簿・活動・回答はすべて消えます。</p>
    <label class="field">名簿スプレッドシートの URL（リンクを知っている全員が閲覧可にしたもの）
      <input type="text" data-change="rosterSheetUrl" value="${esc(state.settings.rosterSheetUrl ?? '')}" placeholder="https://docs.google.com/spreadsheets/d/…/edit">
    </label>
    <div class="row">
      ${armedButton('load-test:all', 'テストデータに置き換える', 'もう一度押すと置き換え')}
      <button class="btn small" data-act="test-csv">取り込み用の名簿を入力欄に入れる</button>
    </div>
  </section>
  <a class="btn block" href="#/">戻る</a>`;
}

// ---- ルーティング ----
function render() {
  const [route, id] = location.hash.replace(/^#\/?/, '').split('/');
  const event = id ? findEvent(id) : null;
  let html;
  if (ui.loading) html = `${top(false)}<section class="card"><p class="muted">読み込み中…</p></section>`;
  else if (ui.error) html = renderLoadError();
  else if (route !== 'a' && backend.needsLogin()) html = renderLogin();
  else if (route === 'new') html = renderEventForm(null);
  else if (route === 'edit' && event) html = renderEventForm(event);
  else if (route === 'a' && event) html = renderAnswer(event);
  else if (route === 'm' && event) html = renderManage(event);
  else if (route === 'roster') html = renderRoster();
  else if (['edit', 'a', 'm'].includes(route)) html = `${top(false)}<section class="card"><p>この活動は見つかりませんでした。</p></section>`;
  else html = renderHome();
  app.innerHTML = html + (ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : '');
  const answerForm = app.querySelector('form[data-form="answer"]');
  if (answerForm) syncAnswerForm(answerForm);
}

function renderLogin() {
  return `${top(false)}
  <form class="card" data-form="login">
    <h1>管理画面</h1>
    <p class="muted">管理用パスワードを入力してください。この端末では次回から入力は不要です。</p>
    <label class="field">パスワード<input type="password" name="password" required autocomplete="current-password"></label>
    <p class="error hidden" data-error></p>
    <button class="btn primary block">ログイン</button>
  </form>`;
}

function renderLoadError() {
  return `${top(false)}
  <section class="card">
    <p class="error">読み込めませんでした：${esc(ui.error)}</p>
    <button class="btn" data-act="refresh">もう一度読み込む</button>
  </section>`;
}

/** クリップボードへコピー。使えない環境（埋め込み表示など）では従来の方法で試す */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch { /* 下の方法で試す */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('copy');
}

function showToast(text) {
  ui.toast = text;
  render();
  setTimeout(() => { ui.toast = ''; render(); }, 1800);
}

function markShared(id) {
  const event = findEvent(id);
  event.sharedBody = L.buildResultBody(event, viewsOf(event), state.settings);
  persist();
}

// ---- 操作 ----
const armedActions = {
  'del-event': (id) => {
    state.events = state.events.filter((e) => e.id !== id);
    delete state.responses[id];
    location.hash = '#/';
  },
  'load-test': async () => {
    showToast('スプレッドシートを読み込み中…');
    const sheet = await fetchSheetRoster(state.settings.rosterSheetUrl);
    state = testState(sheet, state.settings);
    await backend.replaceAll(state);
    location.hash = '#/';
    const note = sheet.skipped.length ? `（対象外：${sheet.skipped.join('、')}）` : '';
    setTimeout(() => showToast(`最新の名簿でテストデータを作りました${note}`), 0);
  },
  'del-person': (id) => {
    state.roster = state.roster
      .filter((p) => p.id !== id)
      .map((p) => (p.childIds ? { ...p, childIds: p.childIds.filter((c) => c !== id) } : p));
  },
};

app.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const { act } = el.dataset;
  if (act === 'sample') {
    state = sampleState();
    render();
    queueSave(() => backend.replaceAll(state));
  } else if (act === 'refresh') {
    loadForRoute();
  } else if (act === 'logout') {
    backend.logout();
    location.hash = '#/';
    render();
  } else if (act === 'test-csv') {
    try {
      ui.importText = rosterCsv((await fetchSheetRoster(state.settings.rosterSheetUrl)).roster);
    } catch (err) {
      showToast(err.message.includes('URL') ? err.message : 'スプレッドシートを読み込めませんでした');
      return;
    }
    ui.importRows = L.parseRoster(ui.importText, state.roster);
    render();
    document.getElementById('import-text')?.scrollIntoView({ block: 'center' });
  } else if (act === 'import-check') {
    ui.importText = document.getElementById('import-text').value;
    ui.importRows = L.parseRoster(ui.importText, state.roster);
    render();
  } else if (act === 'import-apply') {
    const before = state.roster.length;
    // 確認後に名簿が変わっていても重複しないよう、最新の名簿で解析し直す
    state.roster = L.applyRoster(state.roster, L.parseRoster(ui.importText, state.roster), newId);
    const added = state.roster.length - before;
    ui.importText = '';
    ui.importRows = null;
    persist();
    showToast(`${added}人を登録しました`);
  } else if (act === 'import-cancel') {
    ui.importText = '';
    ui.importRows = null;
    render();
  } else if (act === 'arm') {
    const { key } = el.dataset;
    if (ui.armed === key) {
      const [name, id] = key.split(':');
      ui.armed = '';
      try {
        await armedActions[name](id);
      } catch (err) {
        showToast(name === 'load-test' && !err.message.includes('URL') ? 'スプレッドシートを読み込めませんでした' : err.message || '操作できませんでした');
        return;
      }
      commit();
    } else {
      ui.armed = key;
      render();
    }
  } else if (act === 'auto') {
    const event = findEvent(el.dataset.id);
    const key = `auto:${event.id}`;
    if (event.alloc && ui.armed !== key) {
      ui.armed = key;
      render();
      return;
    }
    ui.armed = '';
    const responses = responsesOf(event.id);
    event.alloc = Object.fromEntries(L.legsOf(event).map((leg) => [leg.id, L.autoAssign(rosterOf(event), responses, leg.id, { maxCars: L.maxCarsOf(event) })]));
    commit();
  } else if (act === 'car-off' || act === 'car-on') {
    const event = findEvent(routeId());
    const { dir, driver } = el.dataset;
    event.alloc = event.alloc ?? {};
    event.alloc[dir] = L.setCarUsed(event.alloc[dir] ?? [], driver, act === 'car-on');
    commit();
  } else if (act === 'add-leg') {
    const container = el.closest('fieldset').querySelector('[data-legs]');
    const rows = container.querySelectorAll('[data-leg]');
    const lastTo = rows.length ? rows[rows.length - 1].querySelector('[data-leg-to]').value : '';
    container.insertAdjacentHTML('beforeend', legRow({ id: `l${newId()}`, from: lastTo, to: '', toll: false }, rows.length));
    renumberLegs(container);
    container.lastElementChild.querySelector('[data-leg-to]').focus();
  } else if (act === 'del-leg') {
    const container = el.closest('[data-legs]');
    el.closest('[data-leg]').remove();
    renumberLegs(container);
  } else if (act === 'same-legs') {
    const form = el.closest('form');
    const [first, ...rest] = form.dataset.legs.split(',');
    const copy = (name, from) => {
      const value = form.querySelector(`input[name="${from}"]:checked`)?.value;
      if (!value) return;
      const target = form.querySelector(`input[name="${name}"][value="${value}"]`);
      if (target) target.checked = true;
    };
    for (const leg of rest) {
      copy(leg, first);
      form.querySelectorAll('[data-child]').forEach((block) => copy(`c-${block.dataset.child}-${leg}`, `c-${block.dataset.child}-${first}`));
    }
    syncAnswerForm(form);
  } else if (act === 'copy') {
    if (el.dataset.shared) markShared(el.dataset.shared);
    try {
      await copyText(el.dataset.text);
      showToast('コピーしました');
    } catch {
      showToast('コピーできませんでした');
    }
  } else if (act === 'shared') {
    // リンクの遷移を妨げないよう、クリック処理の後で記録する
    setTimeout(() => { markShared(el.dataset.id); render(); }, 0);
  }
});

app.addEventListener('change', (ev) => {
  const el = ev.target;
  const kind = el.dataset.change;
  const form = el.closest('form[data-form="answer"]');
  if (form && el.matches('[data-role]') && el.checked) {
    form.querySelectorAll(`input[name="${el.name}"]`).forEach((other) => { if (other !== el) other.checked = false; });
  }
  if (form) syncAnswerForm(form);
  if (!kind) return;
  if (kind === 'who') {
    ui.who = el.value;
    ui.saved = false;
    render();
  } else if (kind === 'move') {
    const [, id] = location.hash.replace(/^#\/?/, '').split('/');
    const event = findEvent(id);
    event.alloc[el.dataset.dir] = L.moveRider(event.alloc[el.dataset.dir] ?? [], el.dataset.rider, el.value);
    commit();
  } else if (kind === 'import-file') {
    if (el.files[0]) readImportFile(el.files[0]);
  } else if (kind === 'child') {
    const parent = state.roster.find((p) => p.id === el.dataset.parent);
    const others = (parent.childIds ?? []).filter((id) => id !== el.value);
    parent.childIds = el.checked ? [...others, el.value] : others;
    persist();
    document.getElementById('unlinked').innerHTML = unlinkedNotice();
  } else if (kind === 'grade') {
    const player = state.roster.find((p) => p.id === el.dataset.id);
    if (el.value) player.grade = el.value;
    else delete player.grade;
    persist();
  } else if (kind === 'rosterSheetUrl') {
    state.settings.rosterSheetUrl = el.value.trim();
    persist();
  } else if (kind === 'tollFee') {
    state.settings.tollFee = Math.max(0, Number(el.value) || 0);
    persist();
  } else if (kind === 'driverChildPays') {
    state.settings.driverChildPays = el.checked;
    persist();
  }
});

function syncAnswerForm(form) {
  const attend = form.querySelector('[data-role]')
    ? L.householdAttend(Object.fromEntries(L.PARENT_ROLES.map((role) => [role.id, roleValue(form, role.id)])))
    : form.elements.attend.value;
  const going = attend === 'yes' || attend === 'shuttle';
  form.querySelector('[data-transport]').classList.toggle('hidden', !going);
  const legIds = form.dataset.legs.split(',');
  const valueOf = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value ?? '';
  for (const dir of legIds) {
    // 送迎のみ（以前の回答）の方は同乗しないので「乗せてほしい」を選べないようにする
    const ride = form.querySelector(`input[name="${dir}"][value="ride"]`);
    if (!ride) continue; // 世帯には「乗せてほしい」の選択肢がない
    ride.closest('label').classList.toggle('hidden', attend === 'shuttle');
    if (attend === 'shuttle') ride.checked = false;
  }
  const carIn = Object.fromEntries(legIds.map((dir) => [dir, going && valueOf(dir) === 'car']));
  form.querySelector('[data-car]').classList.toggle('hidden', !Object.values(carIn).some(Boolean));
  form.querySelectorAll('[data-child]').forEach((block) => {
    const childAttend = valueOf(`c-${block.dataset.child}-attend`);
    block.querySelector('[data-child-moves]').classList.toggle('hidden', childAttend !== 'yes');
    for (const dir of legIds) {
      const row = block.querySelector(`[data-child-dir="${dir}"]`);
      row.querySelector('[data-dir-choice]').classList.toggle('hidden', carIn[dir]);
    }
  });
}

/** 入力内容を消さないよう、画面を描き直さずにエラーだけ表示する */
function showFormError(form, message) {
  const el = form.querySelector('[data-error]');
  el.textContent = message;
  el.classList.remove('hidden');
  return false;
}

const formHandlers = {
  event(form, data) {
    const fields = {
      title: data.get('title').trim(),
      date: data.get('date'),
      destination: data.get('destination').trim(),
      meetTime: data.get('meetTime'),
      meetPlace: data.get('meetPlace').trim(),
      note: data.get('note').trim(),
      carLimit: Number(data.get('carLimit')) > 0 ? Math.floor(Number(data.get('carLimit'))) : null,
      target: data.get('target') || 'all',
      legs: [...form.querySelectorAll('[data-leg]')].map((row) => ({
        id: row.dataset.leg,
        from: row.querySelector('[data-leg-from]').value.trim(),
        to: row.querySelector('[data-leg-to]').value.trim(),
        toll: row.querySelector('[data-leg-toll]').checked,
      })),
    };
    const existing = findEvent(form.dataset.id);
    if (existing) {
      delete existing.tollOut;
      delete existing.tollBack;
      Object.assign(existing, fields);
    } else {
      const id = newId();
      state.events.push({ id, ...fields });
      location.hash = `#/m/${id}`;
      return;
    }
    location.hash = `#/m/${existing.id}`;
  },
  answer(form, data) {
    const id = routeId();
    const person = rosterOf(findEvent(id)).find((p) => p.id === ui.who);
    const isHousehold = person.type === 'parent';
    const roles = {};
    for (const role of isHousehold ? L.PARENT_ROLES : []) {
      roles[role.id] = roleValue(form, role.id);
    }
    const attend = isHousehold ? L.householdAttend(roles) : data.get('attend');
    const going = attend === 'yes' || attend === 'shuttle';
    const legs = L.legsOf(findEvent(id));
    const moves = Object.fromEntries(legs.map((leg) => [leg.id, data.get(leg.id)]));
    const memo = data.get('memo').trim();
    if (!attend) return showFormError(form, '参加について選んでください');
    const missingLeg = legs.findIndex((leg) => !moves[leg.id]);
    if (going && missingLeg >= 0) return showFormError(form, `${L.legName(legs, missingLeg)}の移動を選んでください`);
    const carIn = Object.fromEntries(legs.map((leg) => [leg.id, going && moves[leg.id] === 'car']));
    const hasCar = Object.values(carIn).some(Boolean);
    if (attend === 'shuttle' && !hasCar) return showFormError(form, '送迎のみの場合は、どこかの区間で「配車できる」を選んでください');
    const driver = data.get('driver');
    if (hasCar && form.elements.driver && !driver) return showFormError(form, '運転手（父・母）を選んでください');
    if (hasCar && isHousehold && roles[driver] === 'no') {
      return showFormError(form, '運転手は、親の参加で選んだ方にしてください');
    }

    const childAnswers = {};
    for (const child of person.type === 'parent' ? childrenOf(person) : []) {
      const prefix = `c-${child.id}`;
      const childAttend = data.get(`${prefix}-attend`);
      if (!childAttend) return showFormError(form, `${child.name}の参加・不参加を選んでください`);
      if (childAttend === 'no') {
        childAnswers[child.id] = { attend: 'no', seats: 0 };
        continue;
      }
      const childMoves = Object.fromEntries(legs.map((leg) => [leg.id, carIn[leg.id] ? 'ride' : data.get(`${prefix}-${leg.id}`)]));
      if (Object.values(childMoves).some((m) => !m)) return showFormError(form, `${child.name}の移動を選んでください`);
      childAnswers[child.id] = { attend: 'yes', ...childMoves, seats: 0 };
    }

    const answers = {
      ...childAnswers,
      [ui.who]: going
        ? {
          attend,
          ...roles,
          ...moves,
          seats: hasCar ? Math.max(0, Number(data.get('seats')) || 0) : 0,
          driver: hasCar ? driver ?? '' : '',
          memo,
        }
        : { attend, ...roles, seats: 0, memo },
    };
    state.responses[id] = { ...responsesOf(id), ...answers };
    return { eventId: id, answers };
  },
  person(form, data) {
    const name = data.get('name').trim();
    if (!name) return;
    const type = data.get('type');
    state.roster.push(type === 'parent' ? { id: newId(), name, type, childIds: [] } : { id: newId(), name, type });
  },
};

app.addEventListener('submit', async (ev) => {
  const form = ev.target;
  const kind = form.dataset.form;
  if (kind === 'login') {
    ev.preventDefault();
    try {
      await backend.login(new FormData(form).get('password'));
    } catch (err) {
      showFormError(form, err.message);
      return;
    }
    loadForRoute();
    return;
  }
  const handler = formHandlers[kind];
  if (!handler) return;
  ev.preventDefault();
  const result = handler(form, new FormData(form));
  if (result === false) return;
  if (kind === 'answer') {
    // 回答は世帯ごとに保存する（ほかの世帯の回答を上書きしない）
    const button = form.querySelector('button.primary');
    button.disabled = true;
    try {
      await backend.saveAnswer(state, result.eventId, result.answers);
    } catch (err) {
      button.disabled = false;
      showFormError(form, `送信できませんでした。もう一度お試しください（${err.message}）`);
      return;
    }
    ui.saved = true;
    render();
    window.scrollTo(0, 0);
    return;
  }
  commit();
});

window.addEventListener('hashchange', () => {
  ui.armed = '';
  ui.saved = false;
  backend.syncHash(location.hash);
  window.scrollTo(0, 0);
  const [route, id] = location.hash.replace(/^#\/?/, '').split('/');
  // 公開版では、集計画面・ホームを開くたびに最新の回答を読み込む
  const stale = backend.remote
    ? route === 'm' || route === '' || route === 'a' || ui.loadedFor !== 'admin'
    : false;
  if (stale && !(route === 'a' && ui.loadedFor === `a:${id}`)) loadForRoute();
  else render();
});

(async () => {
  const hash = await backend.initialHash();
  if (hash && hash !== location.hash) history.replaceState(null, '', hash);
  await loadForRoute();
})();
