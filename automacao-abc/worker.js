
'use strict';

// O Bicho Certo — monitoramento prospectivo dos radares A, B e C.
// Não altera os resultados existentes nem o Radar 22 do site.
const {
  group, lookActualTime, r22PairType, r22Score, r221Score
} = require('./radar-models');

const REPO = process.env.GITHUB_REPOSITORY || 'alailsonn/O-bicho-certo';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const TOKEN = process.env.GITHUB_TOKEN;
const SOURCE = 'data/look/results.json';
const LEDGER = 'data/look/radares-abc-100.json';
const API = `https://api.github.com/repos/${REPO}/contents/`;

function headers() {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'O-Bicho-Certo-ABC'
  };
}

async function getFile(path, optional = false) {
  const response = await fetch(
    API + path + '?ref=' + encodeURIComponent(BRANCH),
    { headers: headers() }
  );

  if (optional && response.status === 404) return null;

  if (!response.ok) {
    throw Error(`Falha ao ler ${path}: HTTP ${response.status}`);
  }

  const file = await response.json();
  const text = Buffer.from(
    file.content.replace(/\s/g, ''), 'base64'
  ).toString('utf8');

  return { sha: file.sha, value: JSON.parse(text) };
}

async function putFile(path, value, sha) {
  const body = {
    message: 'Registrar acompanhamento prospectivo ABC [skip ci]',
    branch: BRANCH,
    content: Buffer.from(
      JSON.stringify(value, null, 2) + '\n'
    ).toString('base64')
  };

  if (sha) body.sha = sha;

  const response = await fetch(API + path, {
    method: 'PUT',
    headers: {
      ...headers(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw Error(`Falha ao salvar ${path}: HTTP ${response.status}`);
  }
}

function normalize(row) {
  if (!row || !Array.isArray(row.p)) return null;

  const date = String(row.date || '');
  const time = lookActualTime(row);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  if (!/^(07|09|11|14|16|18|19|21|23):20$/.test(time)) {
    return null;
  }

  const p = row.p.slice(0, 5).map(
    x => String(x).padStart(4, '0')
  );

  if (
    p.length !== 5 ||
    p.some(x => !/^\d{4}$/.test(x))
  ) {
    return null;
  }

  return { date, time, p };
}

function loadRows(data) {
  if (!Array.isArray(data)) {
    throw Error('Histórico LOOK inválido');
  }

  const map = new Map();

  for (const item of data) {
    const row = normalize(item);
    if (!row) continue;

    const key = row.date + '|' + row.time;

    if (map.has(key) && id(map.get(key)) !== id(row)) {
      throw Error(`Conflito em resultado LOOK: ${key}`);
    }

    map.set(key, row);
  }

  return [...map.values()].sort((a, b) =>
    (a.date + a.time).localeCompare(b.date + b.time)
  );
}

function id(row) {
  return row.date + '|' + row.time + '|' + row.p.join('-');
}

function timestamp(date, time) {
  return Date.parse(`${date}T${time}:00-03:00`);
}

function nextDraw(row) {
  const slots = {
    '07:20': '09:20',
    '09:20': '11:20',
    '11:20': '14:20',
    '14:20': '16:20',
    '16:20': '18:20',
    '18:20': '19:20',
    '19:20': '21:20',
    '21:20': '23:20'
  };

  if (row.time === '23:20') {
    const d = new Date(row.date + 'T12:00:00Z');

    if (Number.isNaN(d.getTime())) return null;

    d.setUTCDate(d.getUTCDate() + 1);

    return {
      date: d.toISOString().slice(0, 10),
      time: '07:20'
    };
  }

  return slots[row.time]
    ? { date: row.date, time: slots[row.time] }
    : null;
}

function picksFor(rows) {
  const origin = rows.at(-1);
  const transitions = [];

  for (let i = 0; i < rows.length - 1; i++) {
    if (r22PairType(rows[i], rows[i + 1])) {
      transitions.push({
        origin: rows[i],
        next: rows[i + 1],
        g: group(rows[i + 1].p[0])
      });
    }
  }

  return {
    A: r22Score(origin, rows, transitions)
      .slice(0, 5).map(x => x.g),

    B: r221Score(origin, rows, transitions, 'horario')
      .slice(0, 5).map(x => x.g),

    C: r221Score(origin, rows, transitions, 'sete')
      .slice(0, 5).map(x => x.g)
  };
}

function processRows(rows, state, now = new Date()) {
  let changed = false;

  // Conferir somente escolhas registradas anteriormente.
  for (const record of state.records) {
    if (record.status !== 'pending') continue;

    const index = rows.findIndex(
      row => id(row) === record.originId
    );

    if (index < 0) {
      if (rows.some(row =>
        row.date + row.time >=
        record.originDate + record.originTime
      )) {
        record.status = 'invalid';
        record.note = 'Origem alterada ou removida';
        changed = true;
      }
      continue;
    }

    if (index === rows.length - 1) continue;

    const origin = rows[index];
    const target = rows[index + 1];
    const type = r22PairType(origin, target);

    const targetTime = timestamp(
      target.date, target.time
    );

    const lockedTime = Date.parse(record.lockedAt);

    if (
      !Number.isFinite(lockedTime) ||
      !Number.isFinite(targetTime) ||
      lockedTime >= targetTime
    ) {
      record.status = 'invalid';
      record.note = 'Registro feito após a extração';
      changed = true;
      continue;
    }

    if (!type) {
      record.status = 'invalid';
      record.note = 'Extrações não consecutivas';
      changed = true;
      continue;
    }

    const actual = group(target.p[0]);

    record.status = 'done';
    record.targetId = id(target);
    record.targetDate = target.date;
    record.targetTime = target.time;
    record.type = type;
    record.actual = actual;

    record.hits = {
      A: record.picks.A.includes(actual),
      B: record.picks.B.includes(actual),
      C: record.picks.C.includes(actual)
    };

    record.checkedAt = now.toISOString();
    changed = true;
  }

  const completed = state.records.filter(
    r => r.status === 'done'
  ).length;

  if (completed >= state.limit) return changed;

  if (state.records.some(
    r => r.status === 'pending'
  )) {
    return changed;
  }

  if (rows.length < 26) return changed;

  const origin = rows.at(-1);
  const next = nextDraw(origin);

  if (!next) return changed;

  const originTime = timestamp(
    origin.date, origin.time
  );

  const deadline = timestamp(
    next.date, next.time
  );

  // Não registrar antes da origem ou depois do prazo.
  if (
    !Number.isFinite(originTime) ||
    !Number.isFinite(deadline) ||
    now.getTime() < originTime ||
    now.getTime() >= deadline
  ) {
    return changed;
  }

  // Não repetir a mesma origem.
  if (state.records.some(
    r => r.originId === id(origin)
  )) {
    return changed;
  }

  const picks = picksFor(rows);

  const valid = Object.values(picks).every(v =>
    v.length === 5 &&
    new Set(v).size === 5 &&
    v.every(g =>
      Number.isInteger(g) &&
      g >= 1 &&
      g <= 25
    )
  );

  if (!valid) {
    throw Error(
      'Seleções inválidas: registro interrompido'
    );
  }

  state.records.push({
    status: 'pending',
    originId: id(origin),
    originDate: origin.date,
    originTime: origin.time,
    lockedAt: now.toISOString(),
    earliestDate: next.date,
    earliestTime: next.time,
    picks
  });

  return true;
}

async function main() {
  if (!TOKEN) {
    throw Error(
      'GITHUB_TOKEN não configurado no Render'
    );
  }

  const source = await getFile(SOURCE);
  const rows = loadRows(source.value);

  if (rows.length < 26) {
    throw Error('Histórico insuficiente');
  }

  const existing = await getFile(LEDGER, true);

  const state = existing
    ? existing.value
    : { version: 1, limit: 100, records: [] };

  if (
    state.version !== 1 ||
    state.limit !== 100 ||
    !Array.isArray(state.records)
  ) {
    throw Error(
      'Placar incompatível — não foi alterado'
    );
  }

  const changed = processRows(rows, state);

  if (changed) {
    await putFile(
      LEDGER,
      state,
      existing?.sha
    );
  }

  console.log(JSON.stringify({
    results: rows.length,
    changed,
    completed: state.records.filter(
      r => r.status === 'done'
    ).length,
    pending: state.records.filter(
      r => r.status === 'pending'
    ).length,
    invalid: state.records.filter(
      r => r.status === 'invalid'
    ).length
  }));
}

if (require.main === module) {
  main().catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  });
}

module.exports = {
  loadRows,
  processRows,
  picksFor,
  nextDraw
};
