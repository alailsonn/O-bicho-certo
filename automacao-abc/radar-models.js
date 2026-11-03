
'use strict';

// Regras originais do Radar 22 — LOOK Goiás.
// A = original; B = sem histórico por horário;
// C = sem chamada ±7.

const lgMainGroups = [
  [1,2,3],[3,4,5],[5,6,7,8],[8,9,10],
  [10,11,12,13],[13,14,15],[15,16,17,18],
  [18,19,20],[20,21,22,23],[23,24,25]
];

const lgAuxGroups = [
  [10,20],[1,11,21],[2,12,22],[3,13,23],
  [4,14,24],[5,15,25],[6,16],[7,17],
  [8,18],[9,19]
];

const ltPad = n => String(n).padStart(4, '0');

function group(n) {
  const d = Number(ltPad(n).slice(-2));
  return d === 0 ? 25 : Math.ceil(d / 4);
}

function lookActualTime(r) {
  const raw = String(
    (r && r.horario_real) || (r && r.time) || ''
  ).trim();

  return /^\d{2}:00$/.test(raw)
    ? raw.slice(0, 2) + ':20'
    : raw;
}

function ltMissing(r) {
  const seen = new Set(
    r.p.slice(0, 5).map(ltPad).join('')
  );

  return [...'0123456789'].filter(
    d => !seen.has(d)
  );
}

const r22PlannedNext = {
  '07:20': ['09:20'],
  '09:20': ['11:20'],
  '11:20': ['14:20'],
  '14:20': ['16:20'],
  '16:20': ['18:20', '19:20'],
  '18:20': ['19:20', '21:20'],
  '19:20': ['21:20'],
  '21:20': ['23:20']
};

function r22Tomorrow(date) {
  const d = new Date(date + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return null;

  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function r22PairType(a, b) {
  if (!a || !b) return null;

  const ah = lookActualTime(a);
  const bh = lookActualTime(b);

  if (
    a.date === b.date &&
    (r22PlannedNext[ah] || []).includes(bh)
  ) {
    return 'same';
  }

  if (
    ah === '23:20' &&
    bh === '07:20' &&
    b.date === r22Tomorrow(a.date)
  ) {
    return 'overnight';
  }

  return null;
}

function scoreRadar(origin, seen, transitions, omit) {
  const missing = ltMissing(origin);
  const pastHeads = seen.slice(-40);
  const hour = lookActualTime(origin);

  const matching = transitions.filter(
    t => lookActualTime(t.origin) === hour
  );

  const freqHour = Array(26).fill(0);
  const freqRecent = Array(26).fill(0);

  matching.forEach(t => freqHour[t.g]++);
  pastHeads.forEach(
    r => freqRecent[group(r.p[0])]++
  );

  const exact = new Set();
  const inverse = new Set();

  origin.p.slice(0, 5).forEach(p => {
    const num = ltPad(p);

    for (let i = 0; i <= 2; i++) {
      const pair = num.slice(i, i + 2);

      exact.add(group(pair));
      inverse.add(
        group(pair.split('').reverse().join(''))
      );
    }
  });

  const currentGroup = group(origin.p[0]);
  const plus7 = (currentGroup + 6) % 25 + 1;
  const minus7 = (currentGroup + 17) % 25 + 1;

  const scores = [];

  for (let g = 1; g <= 25; g++) {
    const main = missing.filter(
      d => lgMainGroups[Number(d)].includes(g)
    );

    const aux = missing.filter(
      d => lgAuxGroups[Number(d)].includes(g)
    );

    const pairExact = exact.has(g);
    const pairInverse = inverse.has(g);
    const seven = g === plus7 || g === minus7;

    const sameHourWeight = 0.45 * Math.min(
      2,
      ((freqHour[g] + 1) / (matching.length + 25)) * 25
    );

    const recentWeight = 0.30 * Math.min(
      2,
      ((freqRecent[g] + 1) / (pastHeads.length + 25)) * 25
    );

    const score =
      1.35 * Math.min(2, main.length) +
      1.25 * Math.min(2, aux.length) +
      (pairExact ? 0.80 : 0) +
      (pairInverse ? 0.95 : 0) +
      (seven && omit !== 'sete' ? 0.40 : 0) +
      (omit === 'horario' ? 0 : sameHourWeight) +
      recentWeight;

    scores.push({ g, score });
  }

  return scores.sort(
    (a, b) => b.score - a.score || a.g - b.g
  );
}

function r22Score(origin, seen, transitions) {
  return scoreRadar(origin, seen, transitions, null);
}

function r221Score(origin, seen, transitions, omit) {
  return scoreRadar(origin, seen, transitions, omit);
}

module.exports = {
  group,
  lookActualTime,
  r22PairType,
  r22Score,
  r221Score
};
