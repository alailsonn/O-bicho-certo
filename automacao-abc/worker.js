
'use strict';

// O Bicho Certo — acompanhamento prospectivo ABC
// Não modifica Radar 22 nem históricos anteriores.

const {
  group,
  lookActualTime,
  r22PairType,
  r22Score,
  r221Score
} = require('./radar-models');

const repo = process.env.GITHUB_REPOSITORY || 'alailsonn/O-bicho-certo';
const branch = process.env.GITHUB_BRANCH || 'main';
const sourcePath = 'data/look/results.json';
const ledgerPath = 'data/look/radares-abc-100.json';
const token = process.env.GITHUB_TOKEN;

const base = `https://api.github.com/repos/${repo}/contents/`;

function headers() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'O-Bicho-Certo-ABC'
  };
}

async function getFile(path, optional = false) {
  const url = base + path + '?ref=' + encodeURIComponent(branch);
  const response = await fetch(url, { headers: headers() });

  if (optional && response.status === 404) return null;
  if (!response.ok) {
    throw Error(`Erro ao ler ${path}: ${response.status}`);
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
    branch,
    content: Buffer.from(
      JSON.stringify(value, null, 2) + '\n'
    ).toString('base64')
  };

  if (sha) body.sha = sha;

  const response = await fetch(base + path, {
    method: 'PUT',
    headers: {
      ...headers(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw Error(`Erro ao salvar ${path}: ${response.status}`);
  }
}

function normalize(row) {
  if (!row || !Array.isArray(row.p)) return null;

  const date = row.date;
  const time = lookActualTime(row);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^(07|09|11|14|16|18|19|21|23):20$/.test(time)) {
    return null;
  }

  const p = row.p.slice(0, 5).map(x =>
    String(x).padStart(4, '0')
  );

  if (p.length !== 5 || p.some(x => !/^\d{4}$/.test(x))) {
    return null;
  }

  return { date, time, p };
}

function loadRows(data) {
  if (!Array.isArray(data)) throw Error('Histórico inválido');

  const map = new Map();

  for (const item of data) {
    const row = normalize(item);
    if (row) map.set(row.date + '|' + row.time, row);
  }

  return [...map.values()].sort((a, b) =>
    (a.date + a.time).localeCompare(b.date + b.time)
  );
}

function id(row) {
  return row.date + '|' + row.time + '|' + row.p.join('-');
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
    d.setUTCDate(d.getUTCDate() + 1);
    return { date: d.toISOString().slice(0, 10), time: '07:20' };
  }

  if (!slots[row.time]) return null;
  return { date: row.date, time: slots[row.time] };
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

    const index = rows.findIndex(x => id(x) === record.originId);

    if (index < 0) {
      const altered = rows.some(x =>
        x.date + x.time >= record.originDate + record.originTime
      );

      if (altered) {
        record.status = 'invalid';
        record.note = 'Origem alterada ou removida';
        changed = true;
      }
      continue;
    }

    if (index === rows.length - 1) continue;

    const target = rows[index + 1];
    const type = r22PairType(rows[index], target);

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
    record.actual = actual;
    record.type = type;
    record.hits = {
      A: record.picks.A.includes(actual),
      B: record.picks.B.includes(actual),
      C: record.picks.C.includes(actual)
    };
    record.checkedAt = now.toISOString();
    changed = true;
  }

  const completed = state.records.filter(
    x => x.status === 'done'
  ).length;

  // Não ultrapassar 100 avaliações.
  if (completed >= 100) return changed;

  // Não criar previsão quando já existe uma pendente.
  if (state.records.some(x => x.status === 'pending')) {
    return changed;
  }

  if (rows.length < 26) return changed;

  const origin = rows.at(-1);
  const next = nextDraw(origin);
  if (!next) return changed;

  // Horário local da LOOK Goiás: UTC-3.
  const deadline = Date.parse(
    `${next.date}T${next.time}:00-03:00`
  );

  // Nunca registrar escolhas depois da extração.
  if (now.getTime() >= deadline) return changed;

  // Não repetir a mesma origem.
  if (state.records.some(x => x.originId === id(origin))) {
    return changed;
  }

  const picks = picksFor(rows);

  const valid = Object.values(picks).every(
    values => values.length === 5 &&
      new Set(values).size === 5
  );

  if (!valid) return changed;

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
  if (!token) {
    throw Error('GITHUB_TOKEN não configurado');
  }

  const source = await getFile(sourcePath);
  const rows = loadRows(source.value);

  if (rows.length < 26) {
    throw Error('Histórico insuficiente: mínimo 26 extrações');
  }

  const existing = await getFile(ledgerPath, true);

  const state = existing
    ? existing.value
    : { version: 1, limit: 100, records: [] };

  if (
    state.version !== 1 ||
    state.limit !== 100 ||
    !Array.isArray(state.records)
  ) {
    throw Error('Placar incompatível. Preservado sem alteração.');
  }

  const changed = processRows(rows, state);

  if (changed) {
    await putFile(ledgerPath, state, existing?.sha);
  }

  console.log(JSON.stringify({
    results: rows.length,
    changed,
    completed: state.records.filter(
      x => x.status === 'done'
    ).length,
    pending: state.records.filter(
      x => x.status === 'pending'
    ).length
  }));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { loadRows, processRows, picksFor, nextDraw };
