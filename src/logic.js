// 配車・道路料金・LINE文面のロジック（画面や保存方法に依存しない）

export const DIRS = ['out', 'back'];
export const DIR_LABEL = { out: '行き', back: '帰り' };

// ---- 移動区間 ----
// 活動ごとに区間（出発地→到着地）を持つ。ふだんは「行き」「帰り」の2区間で、3区間以上も設定できる。
// 区間の id は回答（responses[人][区間id]）と配車（alloc[区間id]）のキーになる。

/** 活動の区間一覧。区間を設定する前の活動は、行き・帰りの2区間として扱う */
export function legsOf(event) {
  if (Array.isArray(event.legs) && event.legs.length) return event.legs;
  return [
    { id: 'out', from: '', to: '', toll: Boolean(event.tollOut) },
    { id: 'back', from: '', to: '', toll: Boolean(event.tollBack) },
  ];
}

/** 新しい活動の初期区間 */
export function defaultLegs(from = '', to = '') {
  return [
    { id: 'out', from, to, toll: false },
    { id: 'back', from: to, to: from, toll: false },
  ];
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

/** 区間の呼び名。2区間までは「行き」「帰り」、3区間以上は①②③… */
export function legName(legs, index) {
  if (legs.length <= 2) return ['行き', '帰り'][index];
  return CIRCLED[index] ?? `区間${index + 1}`;
}

/** 区間の経路（例：〇〇小→〇〇グラウンド）。未入力なら空 */
export function legRoute(leg) {
  if (leg.from && leg.to) return `${leg.from}→${leg.to}`;
  return leg.from || leg.to || '';
}

export function legLabel(legs, index) {
  const route = legRoute(legs[index]);
  return route ? `${legName(legs, index)}：${route}` : legName(legs, index);
}

const EMPTY_VIEW = { cars: [], unassigned: [] };
export const DEFAULT_SETTINGS = { tollFee: 600, driverChildPays: true };
export const PERSON_TYPES = [
  { id: 'player', label: '部員' },
  { id: 'parent', label: '保護者' },
  { id: 'coach', label: '監督' },
  { id: 'rep', label: '代表' },
];
const TYPE_BY_TEXT = { 部員: 'player', 高学年: 'player', 低学年: 'player', 保護者: 'parent', 父母: 'parent', 監督: 'coach', 代表: 'rep' };

// ---- 学年区分と活動の対象 ----
export const GRADES = [{ id: 'high', label: '高学年' }, { id: 'low', label: '低学年' }];
export const TARGETS = [{ id: 'all', label: '全員' }, ...GRADES];
export const GRADE_BY_TEXT = { 高学年: 'high', 低学年: 'low' };
export const gradeLabel = (id) => GRADES.find((g) => g.id === id)?.label ?? '';
export const targetLabel = (id) => TARGETS.find((t) => t.id === (id || 'all'))?.label ?? '全員';

/** 部員が活動の対象か。対象が学年のときは、その学年の部員だけ（学年未設定は対象外） */
export function isTargetPlayer(event, player) {
  const target = event.target || 'all';
  return target === 'all' || player.grade === target;
}

/**
 * 活動の対象者だけに絞った名簿。対象外の部員と、対象の子どもがいない世帯を外す。
 * 監督・代表は常に含める。世帯の childIds も対象の子どもだけにする。
 */
export function eventRoster(event, roster) {
  if ((event.target || 'all') === 'all') return roster;
  const targetIds = new Set(roster.filter((p) => p.type === 'player' && isTargetPlayer(event, p)).map((p) => p.id));
  return roster.flatMap((p) => {
    if (p.type === 'player') return targetIds.has(p.id) ? [p] : [];
    if (p.type === 'parent') {
      const childIds = (p.childIds ?? []).filter((id) => targetIds.has(id));
      return childIds.length ? [{ ...p, childIds }] : [];
    }
    return [p];
  });
}

export const DRIVER_LABEL = { father: '父', mother: '母' };
export const ATTEND_LABEL = { yes: '参加', shuttle: '送迎のみ', no: '不参加' };
export const PARENT_ROLES = [{ id: 'father', label: '父' }, { id: 'mother', label: '母' }];

/** 世帯としての参加：誰かが参加なら参加、参加者がいなくて送迎のみがいれば送迎のみ */
export function householdAttend(r) {
  const values = PARENT_ROLES.map((role) => r[role.id]);
  if (values.includes('yes')) return 'yes';
  if (values.includes('shuttle')) return 'shuttle';
  return 'no';
}

/** 同乗するときに使う席の数。世帯は参加する父母の人数分 */
export function seatCount(person, r) {
  if (person.type !== 'parent' || !r) return 1;
  return Math.max(1, PARENT_ROLES.filter((role) => r[role.id] === 'yes').length);
}

export const isAdult = (person) => person.type !== 'player';
export const isAdultType = (type) => type.id !== 'player';
const isOwnChild = (driver, personId) => (driver.childIds ?? []).includes(personId);
export const typeLabel = (type) => PERSON_TYPES.find((t) => t.id === type)?.label ?? '';

/** 片道料金を人数で割る（1円単位で切り上げ） */
export function splitToll(fee, count) {
  return count > 0 ? Math.ceil(fee / count) : 0;
}

/** 車を出せると答えた大人（その区間） */
function ableDrivers(roster, responses, dir) {
  return roster.filter((p) => {
    const r = responses[p.id];
    return isAdult(p) && (r?.attend === 'yes' || r?.attend === 'shuttle') && r[dir] === 'car';
  });
}

/**
 * アンケートの回答者だけを、運転者と同乗者に分ける。
 * - 「送迎のみ」の人は運転者にはなれるが同乗者にはならない。
 * - 親が配車できる方向では、参加する部員は回答によらず同乗者になる（既定は親の車）。
 * - offIds は台数制限などで「使わない」車の運転者。その世帯は同乗者として扱う。
 */
export function candidates(roster, responses, dir, offIds = new Set()) {
  const able = ableDrivers(roster, responses, dir);
  const drivers = able.filter((d) => !offIds.has(d.id));
  const ableIds = new Set(able.map((d) => d.id));
  const drivingParentsChildren = new Set(able.flatMap((d) => d.childIds ?? []));
  const riders = roster.filter((p) => {
    const r = responses[p.id];
    if (offIds.has(p.id) && ableIds.has(p.id)) return r?.attend === 'yes';
    if (r?.attend !== 'yes') return false;
    return r[dir] === 'ride' || (p.type === 'player' && drivingParentsChildren.has(p.id));
  });
  return { drivers, riders };
}

/** 保存済みの配車のうち「使わない」にした車の運転者 */
const offIdsOf = (savedCars) => new Set((savedCars ?? []).filter((c) => c.off).map((c) => c.driverId));

/**
 * 片道分の配車案を作る。
 * - maxCars（使える車の台数。道具車を除く）があれば、多く乗せられる車から選び、残りは「使わない」にする。
 * - 親の車に自分の子を乗せ、残りは部員→大人（必要な席が多い順）で空席が多い車へ入れる。
 * - 乗車可能人数は運転手と自分の子を除いた数なので、自分の子は親の車では席を消費しない。
 */
export function autoAssign(roster, responses, dir, { maxCars } = {}) {
  const seatsOf = (id) => Number(responses[id]?.seats) || 0;
  const all = candidates(roster, responses, dir);
  const riderIdSet = new Set(all.riders.map((r) => r.id));
  const ownKids = (d) => (d.childIds ?? []).filter((id) => riderIdSet.has(id)).length;
  const ranked = [...all.drivers].sort((a, b) => (seatsOf(b.id) + ownKids(b)) - (seatsOf(a.id) + ownKids(a)));
  const limit = Number.isFinite(maxCars) ? Math.max(0, maxCars) : ranked.length;
  const offIds = new Set(ranked.slice(limit).map((d) => d.id));

  const { drivers, riders } = candidates(roster, responses, dir, offIds);
  const cars = drivers
    .map((d) => ({ driverId: d.id, riderIds: [] }))
    .sort((a, b) => seatsOf(b.driverId) - seatsOf(a.driverId));
  const driverOf = (car) => drivers.find((d) => d.id === car.driverId);
  const need = (id) => seatCount(roster.find((p) => p.id === id), responses[id]);
  const free = (car) => seatsOf(car.driverId)
    - car.riderIds.filter((id) => !isOwnChild(driverOf(car), id)).reduce((n, id) => n + need(id), 0);
  const placed = new Set();

  for (const car of cars) {
    for (const childId of driverOf(car).childIds ?? []) {
      if (riders.some((r) => r.id === childId)) {
        car.riderIds.push(childId);
        placed.add(childId);
      }
    }
  }

  const rest = riders
    .filter((r) => !placed.has(r.id))
    .sort((a, b) => Number(isAdult(a)) - Number(isAdult(b)) || need(b.id) - need(a.id));
  for (const rider of rest) {
    const target = cars.reduce(
      (best, car) => (free(car) >= need(rider.id) && (!best || free(car) > free(best)) ? car : best),
      null,
    );
    if (target) target.riderIds.push(rider.id);
  }
  return [...cars, ...[...offIds].map((driverId) => ({ driverId, riderIds: [], off: true }))];
}

/** 同乗者を別の車へ移す。driverId が空なら未割当に戻す */
export function moveRider(cars, riderId, driverId) {
  const next = cars.map((c) => ({ ...c, riderIds: c.riderIds.filter((id) => id !== riderId) }));
  if (!driverId) return next;
  let car = next.find((c) => c.driverId === driverId);
  if (!car) {
    car = { driverId, riderIds: [] };
    next.push(car);
  }
  car.riderIds.push(riderId);
  return next;
}

/**
 * 車を「使う／使わない」に切り替える。
 * 使わない車の同乗者は未割当に戻り、その世帯は同乗者になる。使う車に戻すと空の車になる。
 */
export function setCarUsed(cars, driverId, used) {
  let next = cars.map((c) => ({ ...c, riderIds: c.riderIds.filter((id) => !(used && id === driverId)) }));
  if (!next.some((c) => c.driverId === driverId)) next.push({ driverId, riderIds: [] });
  next = next.map((c) => {
    if (c.driverId !== driverId) return c;
    return used ? { driverId, riderIds: [] } : { driverId, riderIds: [], off: true };
  });
  return next;
}

/** 保存済みの配車と最新の回答を突き合わせ、画面・計算用の形にする */
export function allocationView(savedCars, roster, responses, dir) {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const saved = savedCars ?? [];
  const ableIds = new Set(ableDrivers(roster, responses, dir).map((d) => d.id));
  const offIds = new Set([...offIdsOf(saved)].filter((id) => ableIds.has(id)));
  const { drivers, riders } = candidates(roster, responses, dir, offIds);
  const driverIds = new Set(drivers.map((d) => d.id));
  const riderIds = new Set(riders.map((r) => r.id));
  const savedOn = saved.filter((c) => !c.off && byId.has(c.driverId));
  const savedDriverIds = new Set(saved.map((c) => c.driverId));

  // 新しく車を出せるようになった親の車には、自分の子を入れる（既定は親の車）。
  // それ以外は保存した配車（手動の組み替えを含む）を優先し、どこにも乗っていない子だけ親の車へ入れる。
  const pulled = new Map();
  for (const d of drivers) {
    if (savedDriverIds.has(d.id)) continue;
    for (const id of d.childIds ?? []) if (riderIds.has(id)) pulled.set(id, d.id);
  }
  const placedInSaved = new Set(savedOn.flatMap((c) => c.riderIds).filter((id) => !pulled.has(id)));
  const defaultsFor = (driver) => (driver.childIds ?? [])
    .filter((id) => riderIds.has(id) && (pulled.get(id) === driver.id || (!pulled.has(id) && !placedInSaved.has(id))));

  const placed = new Set();
  const toCar = (driver, ids) => {
    const carRiders = [...new Set(ids)]
      .filter((id) => byId.has(id) && !placed.has(id))
      .map((id) => {
        placed.add(id);
        const person = byId.get(id);
        return {
          person,
          stale: !riderIds.has(id),
          ownChild: isOwnChild(driver, id),
          seats: seatCount(person, responses[id]),
        };
      });
    const seats = Number(responses[driver.id]?.seats) || 0;
    const used = carRiders.filter((r) => !r.ownChild).reduce((n, r) => n + r.seats, 0);
    return {
      driver,
      driverLabel: DRIVER_LABEL[responses[driver.id]?.driver] ?? '',
      seats,
      used,
      riders: carRiders,
      over: used > seats,
      driverStale: !driverIds.has(driver.id),
    };
  };

  const cars = savedOn
    .map((c) => {
      const driver = byId.get(c.driverId);
      const kept = c.riderIds.filter((id) => !pulled.has(id));
      return toCar(driver, [...defaultsFor(driver), ...kept]);
    })
    .filter((c) => !c.driverStale || c.riders.length > 0);
  for (const driver of drivers) {
    if (!savedOn.some((c) => c.driverId === driver.id)) cars.push(toCar(driver, defaultsFor(driver)));
  }
  return {
    cars,
    unassigned: riders.filter((r) => !placed.has(r.id)),
    off: [...offIds].map((id) => byId.get(id)).filter(Boolean),
  };
}

/** 道具車1台を含めた台数と、台数制限の超過 */
export function carCount(event, view) {
  const limit = Number(event.carLimit) || 0;
  const used = view.cars.filter((c) => !c.driverStale).length + (limit ? 1 : 0);
  return { limit, used, over: Boolean(limit) && used > limit };
}

/** 台数制限から、自動配車で使える車の台数（道具車1台を除く）。制限なしは undefined */
export function maxCarsOf(event) {
  const limit = Number(event.carLimit) || 0;
  return limit ? Math.max(0, limit - 1) : undefined;
}

/** 1台・片道分の道路料金。大人は負担しない */
export function tollForCar(car, fee, settings = DEFAULT_SETTINGS) {
  const childIds = car.driver.childIds ?? [];
  const payers = car.riders
    .map((r) => r.person)
    .filter((p) => p.type === 'player')
    .filter((p) => settings.driverChildPays || !childIds.includes(p.id));
  const share = splitToll(fee, payers.length);
  return { payers, share, total: share * payers.length };
}

/** 全区間の道路料金を、部員ごとの支払い（区間id → 金額）と運転者ごとの受け取りに集計する */
export function tollSummary(event, views, settings = DEFAULT_SETTINGS) {
  const players = new Map();
  const drivers = new Map();
  const cars = {};
  const tolled = legsOf(event).filter((leg) => leg.toll);
  for (const leg of tolled) {
    cars[leg.id] = [];
    for (const car of (views[leg.id] ?? EMPTY_VIEW).cars) {
      const toll = tollForCar(car, settings.tollFee, settings);
      cars[leg.id].push({ car, ...toll });
      for (const p of toll.payers) {
        const row = players.get(p.id)
          ?? { person: p, ...Object.fromEntries(tolled.map((l) => [l.id, 0])), total: 0 };
        row[leg.id] += toll.share;
        row.total += toll.share;
        players.set(p.id, row);
      }
      if (toll.total > 0) {
        const row = drivers.get(car.driver.id) ?? { person: car.driver, total: 0 };
        row.total += toll.total;
        drivers.set(car.driver.id, row);
      }
    }
  }
  return { cars, players: [...players.values()], drivers: [...drivers.values()] };
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const week = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${week})`;
}

function eventLines(event) {
  const target = event.target && event.target !== 'all' ? `（${targetLabel(event.target)}）` : '';
  return [
    `${formatDate(event.date)} ${event.title}${target}`,
    ...(Number(event.carLimit) ? [`台数制限：${Number(event.carLimit)}台（道具車1台を含む）`] : []),
    `行先：${event.destination}`,
    `集合：${event.meetTime}${event.meetPlace ? ` ${event.meetPlace}` : ''}`,
  ];
}

export function buildAnnouncement(event, answerUrl) {
  const lines = ['【活動のお知らせ】', ...eventLines(event)];
  const legs = legsOf(event);
  if (legs.length > 2) {
    lines.push('移動：', ...legs.map((leg, i) => `　${legLabel(legs, i)}`));
  }
  if (event.note) lines.push(`連絡：${event.note}`);
  lines.push('', '参加・配車のアンケートに回答をお願いします。', answerUrl);
  return lines.join('\n');
}

/** 車の呼び方。運転する世帯・大人の名前に「号」を付ける（例：青木号） */
export function carName(driver) {
  return `${driver.name}号`;
}

const names = (people) => people.map((p) => p.name).join('、');

/** 配車結果の本文（見出しを除く） */
export function buildResultBody(event, views, settings = DEFAULT_SETTINGS) {
  const summary = tollSummary(event, views, settings);
  const lines = [...eventLines(event)];
  const legs = legsOf(event);
  legs.forEach((leg, index) => {
    const view = views[leg.id] ?? EMPTY_VIEW;
    const hasToll = leg.toll;
    lines.push('', `＜${legLabel(legs, index)}＞${hasToll ? '有料道路あり' : ''}`);
    if (view.cars.length === 0) lines.push('車の提供なし');
    for (const car of view.cars) {
      const riders = car.riders.map((r) => (r.seats > 1 ? { name: `${r.person.name}（${r.seats}人）` } : r.person));
      const role = car.driverLabel ? `（運転手：${car.driverLabel}）` : '';
      lines.push(`■${carName(car.driver)}${role}：${riders.length ? names(riders) : '同乗者なし'}`);
      if (hasToll) {
        const toll = tollForCar(car, settings.tollFee, settings);
        if (toll.payers.length) {
          lines.push(`　道路料金 部員${toll.payers.length}人で1人${toll.share}円`);
        }
      }
    }
    if (view.unassigned.length) {
      lines.push(`※未定：${names(view.unassigned)}`);
    }
  });
  if (summary.players.length) {
    lines.push('', '＜道路料金の合計＞');
    for (const row of summary.players) lines.push(`${row.person.name}：${row.total}円`);
  }
  return lines.join('\n');
}

/** LINEへ送る配車結果。共有後に内容が変わっていれば「変更」と明示する */
export function buildResultText(event, views, settings = DEFAULT_SETTINGS) {
  const body = buildResultBody(event, views, settings);
  const changed = event.sharedBody && event.sharedBody !== body;
  return `${changed ? '【配車変更のお知らせ】' : '【配車のお知らせ】'}\n${body}`;
}

export function lineShareUrl(text) {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

// ---- 名簿の一括取り込み ----

/** CSVファイルの文字コードを判定して読む（ExcelのCSVはShift_JISのことが多い） */
export function decodeRosterFile(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('shift_jis').decode(buffer);
  }
}

/** Excelからの貼り付け（タブ区切り）とCSV（引用符あり含む）の1行を列に分ける */
function splitColumns(line) {
  if (line.includes('\t')) return line.split('\t').map((c) => c.replace(/^"|"$/g, '').trim());
  const columns = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if ((ch === ',' || ch === '，') && !quoted) {
      columns.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  columns.push(current.trim());
  return columns;
}

const personKey = (name, type) => `${type}:${name}`;

/**
 * 「名前, 区分, お子さんの名前」の形式を解析する。登録はせず、確認用の行を返す。
 * status は new（登録する）/ duplicate（登録済みなので飛ばす）/ error（飛ばす）。
 */
export function parseRoster(text, roster) {
  const seen = new Set(roster.map((p) => personKey(p.name, p.type)));
  const rows = [];
  text.replace(/^﻿/, '').split(/\r?\n/).forEach((line, index) => {
    const [name = '', typeText = '', childText = ''] = splitColumns(line);
    if (!name && !typeText) return;
    if (rows.length === 0 && /^(名前|氏名)$/.test(name)) return;
    const row = { line: index + 1, name, typeText, type: TYPE_BY_TEXT[typeText] ?? '', grade: GRADE_BY_TEXT[typeText] ?? '', childNames: [], status: 'new', note: '' };
    rows.push(row);
    if (!name) {
      row.status = 'error';
      row.note = '名前がありません';
    } else if (!row.type) {
      row.status = 'error';
      row.note = typeText ? `区分「${typeText}」は使えません` : '区分がありません';
    } else if (seen.has(personKey(name, row.type))) {
      row.status = 'duplicate';
      row.note = '登録済み';
    } else {
      seen.add(personKey(name, row.type));
      row.childNames = childText.split(/[、・/／]/).map((c) => c.trim()).filter(Boolean);
    }
  });

  const playerNames = new Set([
    ...roster.filter((p) => p.type === 'player').map((p) => p.name),
    ...rows.filter((r) => r.status === 'new' && r.type === 'player').map((r) => r.name),
  ]);
  for (const row of rows) {
    if (row.status !== 'new' || row.childNames.length === 0) continue;
    if (row.type !== 'parent') {
      row.note = 'お子さんの列は保護者のみ有効です';
      row.childNames = [];
      continue;
    }
    const missing = row.childNames.filter((c) => !playerNames.has(c));
    if (missing.length) row.note = `部員に「${missing.join('、')}」がいないため紐付けません`;
  }
  return rows;
}

/** 確認済みの行を名簿に追加した、新しい名簿を返す */
export function applyRoster(roster, rows, newId) {
  const added = rows.filter((r) => r.status === 'new').map((r) => ({
    id: newId(),
    name: r.name,
    type: r.type,
    ...(r.type === 'parent' ? { childNames: r.childNames } : {}),
    ...(r.grade ? { grade: r.grade } : {}),
  }));
  const next = [...roster, ...added];
  return next.map((person) => {
    if (!person.childNames) return person;
    const { childNames, ...rest } = person;
    const childIds = childNames
      .map((name) => next.find((p) => p.type === 'player' && p.name === name)?.id)
      .filter(Boolean);
    return { ...rest, childIds };
  });
}
