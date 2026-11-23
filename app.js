/* ==========================================================================
 * Ma Vontade — Controle Semanal da Guild
 * ========================================================================== */

const STORAGE_KEY = 'ma_vontade_guild_data_v1';
const SYNC_KEY_STORAGE = 'ma_vontade_sync_key_v1';
const SESSION_KEY = 'ma_vontade_admin_session_v1';

// Hash SHA-256 puro em JS
function sha256(str) {
  const rightRotate = (v, a) => (v >>> a) | (v << (32 - a));
  const maxWord = Math.pow(2, 32);
  let result = '';
  const words = [];
  let hash = sha256.h = sha256.h || [];
  const k = sha256.k = sha256.k || [];
  let primeCounter = k.length;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  const bytes = unescape(encodeURIComponent(str));
  let padded = bytes + '\x80';
  while ((padded.length % 64) - 56) padded += '\x00';
  for (let i = 0; i < padded.length; i++) {
    const j = padded.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (bytes.length * 8 / maxWord) | 0;
  words[words.length] = (bytes.length * 8) | 0;

  const h = hash.slice(0, 8);
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, (j += 16));
    const oldHash = h.slice(0);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = h[0], e = h[4];
      const temp1 = h[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & h[5]) ^ (~e & h[6]))
        + k[i]
        + (w[i] = i < 16 ? w[i] : (
          w[i - 16]
          + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
          + w[i - 7]
          + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
        ) | 0);
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & h[1]) ^ (a & h[2]) ^ (h[1] & h[2]));
      h.unshift((temp1 + temp2) | 0);
      h[4] = (h[4] + temp1) | 0;
      h.pop();
    }
    for (let i = 0; i < 8; i++) h[i] = (h[i] + oldHash[i]) | 0;
  }
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (h[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

const DEFAULT_LEADER_HASH = sha256('leader123');
const DEFAULT_VICE_HASH = sha256('vice123');

// Estado global
let appData = null;
let adminSession = null;
let currentPublicWeekId = null;
let publicFilter = 'active';
let publicSort = { key: 'points', dir: 'desc' };
let adminPenaltyFilter = 'with_strikes';
let pendingUpload = null;

/* ==========================================================================
 * UTILITÁRIOS
 * ========================================================================== */
function normalizeKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('pt-BR') : '0';
}

function todayISO() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d - tzOffset).toISOString().slice(0, 10);
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 3800);
}

function getDefaultData() {
  return {
    guildName: 'Ma Vontade',
    settings: {
      defaultMinPoints: 4,
      defaultMinContribution: 0,
      maxStrikes: 3,
      leaderPasswordHash: DEFAULT_LEADER_HASH,
      vicePasswordHash: DEFAULT_VICE_HASH,
    },
    lastUpdated: new Date().toISOString(),
    weeks: [],
    players: {},
  };
}

/* ==========================================================================
 * PERSISTÊNCIA E SINCRONIZAÇÃO AUTOMÁTICA (DATA.JSON + AUTO-DETECÇÃO)
 * ========================================================================== */
function detectHostedRepo() {
  try {
    const host = window.location.hostname || '';
    if (host.endsWith('.github.io')) {
      const owner = host.replace(/\.github\.io$/, '');
      const segments = (window.location.pathname || '').split('/').filter(Boolean);
      const repo = segments[0] || `${owner}.github.io`;
      return { owner, repo, branch: 'main', path: 'data.json' };
    }
  } catch {
    // ignore
  }
  return null;
}

function getSyncKey() {
  return localStorage.getItem(SYNC_KEY_STORAGE) || '';
}

async function saveLocalData() {
  appData.lastUpdated = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));

  const hosted = detectHostedRepo();
  const token = getSyncKey();
  if (!hosted || !token) return;

  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(hosted.owner)}/${encodeURIComponent(hosted.repo)}/contents/${hosted.path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  try {
    let sha = undefined;
    const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(hosted.branch)}`, { headers });
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
    }

    const jsonString = JSON.stringify(appData, null, 2);
    const bytes = new TextEncoder().encode(jsonString);
    let binary = '';
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    const contentBase64 = btoa(binary);

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `Atualização ${appData.guildName} (${todayISO()}) - ${adminSession?.role || 'Líder'}`,
        content: contentBase64,
        branch: hosted.branch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putRes.ok) {
      throw new Error(`HTTP ${putRes.status}`);
    }
  } catch (err) {
    console.error('Erro ao sincronizar online:', err);
    showToast('Salvo localmente. Verifique a Chave de Sincronização em Configurações.', 'warning');
  }
}

async function fetchRemoteDataJson() {
  const hosted = detectHostedRepo();
  if (hosted) {
    const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(hosted.owner)}/${encodeURIComponent(hosted.repo)}/${encodeURIComponent(hosted.branch)}/${hosted.path}?t=${Date.now()}`;
    try {
      const res = await fetch(rawUrl, { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch {
      // fallback local
    }
  }

  try {
    const res = await fetch(`./data.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {
    // file:// ou sem data.json
  }
  return null;
}

async function initData(forceRemote = false) {
  const localRaw = localStorage.getItem(STORAGE_KEY);
  let localData = null;
  try {
    if (localRaw) localData = JSON.parse(localRaw);
  } catch {
    localData = null;
  }

  const remoteData = await fetchRemoteDataJson();

  if (forceRemote && remoteData) {
    appData = normalizeAppData(remoteData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    showToast('Dados atualizados com sucesso.', 'success');
  } else if (remoteData && localData) {
    const rTime = new Date(remoteData.lastUpdated || 0).getTime();
    const lTime = new Date(localData.lastUpdated || 0).getTime();
    appData = normalizeAppData(rTime >= lTime ? remoteData : localData);
  } else if (remoteData) {
    appData = normalizeAppData(remoteData);
  } else if (localData) {
    appData = normalizeAppData(localData);
  } else {
    appData = getDefaultData();
  }

  try {
    adminSession = JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    adminSession = null;
  }

  selectLatestWeek();
  renderAll();
}

function normalizeAppData(data) {
  const base = getDefaultData();
  const rawPlayers = data.players && typeof data.players === 'object' ? data.players : {};
  const players = {};
  for (const [k, p] of Object.entries(rawPlayers)) {
    if (!p || typeof p !== 'object') continue;
    players[k] = {
      ...p,
      key: p.key || k,
      active: p.active !== false,
      lastKnown: p.lastKnown || {},
      penalties: Array.isArray(p.penalties) ? p.penalties : [],
    };
  }
  const rawWeeks = Array.isArray(data.weeks) ? data.weeks : Object.values(data.weeks || {});
  const weeks = rawWeeks
    .filter((w) => w && typeof w === 'object')
    .map((w) => ({
      ...w,
      newPlayers: Array.isArray(w.newPlayers) ? w.newPlayers : [],
      leftPlayers: Array.isArray(w.leftPlayers) ? w.leftPlayers : [],
      records: w.records && typeof w.records === 'object' ? w.records : {},
    }));

  return {
    guildName: data.guildName || base.guildName,
    settings: {
      defaultMinPoints: Number(data.settings?.defaultMinPoints ?? 4),
      defaultMinContribution: Number(data.settings?.defaultMinContribution ?? 0),
      maxStrikes: Number(data.settings?.maxStrikes ?? 3),
      leaderPasswordHash: data.settings?.leaderPasswordHash || DEFAULT_LEADER_HASH,
      vicePasswordHash: data.settings?.vicePasswordHash || DEFAULT_VICE_HASH,
    },
    lastUpdated: data.lastUpdated || base.lastUpdated,
    weeks,
    players,
  };
}

function selectLatestWeek() {
  if (!appData.weeks.length) {
    currentPublicWeekId = null;
    return;
  }
  const sorted = [...appData.weeks].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  currentPublicWeekId = sorted[0].id;
}

/* ==========================================================================
 * RENDERIZAÇÃO GERAL E VISÃO DOS MEMBROS
 * ========================================================================== */
function renderAll() {
  document.getElementById('guildTitleDisplay').textContent = appData.guildName;
  const dt = appData.lastUpdated ? new Date(appData.lastUpdated).toLocaleString('pt-BR') : '—';
  document.getElementById('lastUpdatedDisplay').textContent = `Controle Semanal · Última atualização: ${dt}`;

  updateAdminBadge();
  renderPublicView();
  if (adminSession) {
    renderAdminPenalties();
    renderAdminWeeks();
    populateSettingsForm();
  }
}

function updateAdminBadge() {
  const badge = document.getElementById('adminSessionBadge');
  const label = document.getElementById('adminRoleLabel');
  if (adminSession) {
    badge.classList.remove('hidden');
    label.textContent = adminSession.role === 'Líder' ? '👑 Líder' : '🛡️ Vice-Líder';
  } else {
    badge.classList.add('hidden');
  }
}

function getActiveWeek() {
  return appData.weeks.find((w) => w.id === currentPublicWeekId) || null;
}

function renderPublicView() {
  const maxStrikes = appData.settings.maxStrikes || 3;
  const playersArr = Object.values(appData.players);
  const activePlayers = playersArr.filter((p) => p.active);

  const select = document.getElementById('publicWeekSelect');
  const sortedWeeks = [...appData.weeks].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  select.innerHTML = sortedWeeks.length
    ? sortedWeeks
        .map((w) => `<option value="${escapeHtml(w.id)}" ${w.id === currentPublicWeekId ? 'selected' : ''}>${escapeHtml(w.label || w.date)} (${escapeHtml(w.date)})</option>`)
        .join('')
    : '<option value="">Nenhuma semana registrada</option>';

  const week = getActiveWeek();

  const goalPills = document.getElementById('publicGoalPills');
  if (week) {
    goalPills.innerHTML = `
      <span class="goal-pill">🎯 Meta Points: ≥ ${formatNumber(week.minPoints)}</span>
      <span class="goal-pill">🤝 Meta Contribution: ≥ ${formatNumber(week.minContribution)}</span>
    `;
  } else {
    goalPills.innerHTML = '<span class="goal-pill">Nenhum arquivo semanal carregado ainda</span>';
  }

  const riskCount = activePlayers.filter((p) => p.penalties.length === maxStrikes - 1).length;
  const excludedCount = playersArr.filter((p) => p.penalties.length >= maxStrikes).length;

  let metCount = 0;
  let totalInWeek = 0;
  if (week) {
    const records = Object.values(week.records || {});
    totalInWeek = records.length;
    metCount = records.filter((r) => r.metGoal).length;
  }

  document.getElementById('kpiActiveCount').textContent = activePlayers.length;
  document.getElementById('kpiRosterDelta').textContent = week
    ? `+${(week.newPlayers || []).length} novos · ${(week.leftPlayers || []).length} saíram`
    : 'Aguardando primeiro envio';
  document.getElementById('kpiMetCount').textContent = `${metCount}/${totalInWeek}`;
  document.getElementById('kpiMetPercent').textContent = totalInWeek
    ? `${Math.round((metCount / totalInWeek) * 100)}% de cumprimento`
    : '0% de cumprimento';
  document.getElementById('kpiRiskCount').textContent = riskCount;
  document.getElementById('kpiExcludedCount').textContent = excludedCount;

  const searchTerm = (document.getElementById('publicSearchInput').value || '').trim().toLowerCase();
  let rows = playersArr.map((p) => {
    const rec = week?.records?.[p.key] || null;
    const strikes = p.penalties.length;
    return {
      player: p,
      key: p.key,
      name: p.name,
      rank: rec?.rank ?? p.lastKnown?.rank ?? '—',
      level: Number(rec?.level ?? p.lastKnown?.level ?? 0),
      status: rec?.status ?? p.lastKnown?.status ?? '—',
      lastLogin: rec?.lastLogin ?? p.lastKnown?.lastLogin ?? '—',
      points: Number(rec?.points ?? 0),
      contribution: Number(rec?.contribution ?? 0),
      inSelectedWeek: Boolean(rec),
      metGoal: rec ? rec.metGoal : null,
      strikes,
      isExcluded: strikes >= maxStrikes,
      isRisk: strikes === maxStrikes - 1,
    };
  });

  rows = rows.filter((r) => {
    if (searchTerm) {
      const hay = `${r.name} ${r.rank}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }
    switch (publicFilter) {
      case 'active': return r.player.active;
      case 'former': return !r.player.active;
      case 'met': return r.inSelectedWeek && r.metGoal === true;
      case 'missed': return r.inSelectedWeek && r.metGoal === false;
      case 'risk': return r.isRisk && r.player.active;
      case 'excluded': return r.isExcluded;
      default: return true;
    }
  });

  const { key, dir } = publicSort;
  const mult = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    if (typeof a[key] === 'number' && typeof b[key] === 'number') {
      return (a[key] - b[key]) * mult;
    }
    return String(a[key]).localeCompare(String(b[key]), 'pt-BR') * mult;
  });

  const tbody = document.getElementById('publicTableBody');
  const empty = document.getElementById('publicEmptyState');

  if (!rows.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  tbody.innerHTML = rows
    .map((r) => {
      const rowCls = r.isExcluded ? 'row-excluded' : !r.player.active ? 'row-former' : '';
      const goalBadge = !r.inSelectedWeek
        ? '<span class="badge badge-muted">Sem registro</span>'
        : r.metGoal
          ? '<span class="badge badge-success">✅ Cumpriu</span>'
          : '<span class="badge badge-danger">❌ Não cumpriu</span>';

      const formerTag = !r.player.active ? ' <span class="badge badge-muted">Ex-membro</span>' : '';
      const strikeHtml = renderStrikeIndicator(r.strikes, maxStrikes);

      return `
        <tr class="${rowCls}">
          <td>
            <div class="player-cell">
              <span>${escapeHtml(r.name)}</span>
              ${formerTag}
            </div>
          </td>
          <td><span class="badge badge-info">${escapeHtml(r.rank)}</span></td>
          <td class="num">${r.level || '—'}</td>
          <td>
            <div>${escapeHtml(r.status)}</div>
            <small class="muted">${escapeHtml(r.lastLogin)}</small>
          </td>
          <td class="num"><strong>${r.inSelectedWeek ? formatNumber(r.points) : '—'}</strong></td>
          <td class="num"><strong>${r.inSelectedWeek ? formatNumber(r.contribution) : '—'}</strong></td>
          <td>${goalBadge}</td>
          <td>${strikeHtml}</td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="openPlayerModal('${escapeHtml(r.key)}')">
              Ver detalhes
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderStrikeIndicator(strikes, maxStrikes = 3) {
  let dots = '';
  for (let i = 1; i <= maxStrikes; i++) {
    let cls = 'dot';
    if (i <= strikes) {
      cls += strikes >= maxStrikes ? ' filled-3' : strikes === maxStrikes - 1 ? ' filled-2' : ' filled-1';
    }
    dots += `<span class="${cls}"></span>`;
  }
  const label = strikes >= maxStrikes
    ? `<span class="badge badge-danger">🚫 ${strikes}/${maxStrikes} EXCLUÍDO</span>`
    : strikes === maxStrikes - 1
      ? `<span class="badge badge-warning">⚠️ ${strikes}/${maxStrikes}</span>`
      : `<span class="muted" style="font-size:0.82rem;margin-left:6px;">${strikes}/${maxStrikes}</span>`;

  return `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span class="strike-dots">${dots}</span>${label}</div>`;
}

/* ==========================================================================
 * MODAL DE DETALHES DO JOGADOR
 * ========================================================================== */
window.openPlayerModal = function (playerKey) {
  const p = appData.players[playerKey];
  if (!p) return;
  const maxStrikes = appData.settings.maxStrikes || 3;

  document.getElementById('pmPlayerName').textContent = p.name;
  document.getElementById('pmPlayerMeta').textContent =
    `${p.active ? 'Membro Ativo' : 'Ex-membro'} · Cargo: ${p.lastKnown?.rank || '—'} · Nível: ${p.lastKnown?.level || '—'}`;
  document.getElementById('pmStrikeCount').textContent = `${p.penalties.length}/${maxStrikes}`;

  const penList = document.getElementById('pmPenaltiesList');
  if (!p.penalties.length) {
    penList.innerHTML = '<p class="muted">Este jogador não possui penalidades registradas. 🎉</p>';
  } else {
    penList.innerHTML = [...p.penalties]
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map((pen) => `
        <div class="penalty-row">
          <div>
            <strong>📅 Semana: ${escapeHtml(pen.date)}</strong>
            <div class="muted">${escapeHtml(pen.reason)} · Registrado por: ${escapeHtml(pen.by || 'Líder')}</div>
          </div>
          ${adminSession ? `<button class="btn btn-danger-outline btn-sm" onclick="removePenalty('${escapeHtml(p.key)}','${escapeHtml(pen.id)}', true)">Perdoar</button>` : ''}
        </div>
      `)
      .join('');
  }

  const sortedWeeks = [...appData.weeks].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const historyRows = sortedWeeks
    .filter((w) => w.records && w.records[playerKey])
    .map((w) => {
      const r = w.records[playerKey];
      return `
        <tr>
          <td>${escapeHtml(w.label || w.date)} <small class="muted">(${escapeHtml(w.date)})</small></td>
          <td>${escapeHtml(r.rank)}</td>
          <td class="num">${r.level}</td>
          <td class="num">${formatNumber(r.points)}</td>
          <td class="num">${formatNumber(r.contribution)}</td>
          <td>${r.metGoal ? (r.redeemedPenalty ? '<span class="badge badge-success">✅ Cumpriu (🕊️ -1 falta)</span>' : '<span class="badge badge-success">✅ Cumpriu</span>') : '<span class="badge badge-danger">❌ Não cumpriu</span>'}</td>
        </tr>
      `;
    });

  document.getElementById('pmHistoryBody').innerHTML = historyRows.length
    ? historyRows.join('')
    : '<tr><td colspan="6" class="muted" style="text-align:center;">Sem registros semanais ainda.</td></tr>';

  document.getElementById('playerModal').classList.remove('hidden');
};

/* ==========================================================================
 * AUTENTICAÇÃO LÍDER / VICE-LÍDER
 * ========================================================================== */
function openLoginModal() {
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('loginModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('loginPassword').focus(), 50);
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const role = document.getElementById('loginRole').value;
  const pass = document.getElementById('loginPassword').value;
  const enteredHash = sha256(pass);

  const expectedHash = role === 'Líder'
    ? appData.settings.leaderPasswordHash
    : appData.settings.vicePasswordHash;

  if (enteredHash !== expectedHash) {
    document.getElementById('loginError').classList.remove('hidden');
    return;
  }

  adminSession = { role };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(adminSession));
  document.getElementById('loginModal').classList.add('hidden');
  switchMainView('admin');
  showToast(`Bem-vindo, ${role}.`, 'success');
}

function logoutAdmin() {
  adminSession = null;
  sessionStorage.removeItem(SESSION_KEY);
  switchMainView('public');
  showToast('Sessão encerrada.', 'info');
}

function switchMainView(view) {
  if (view === 'admin' && !adminSession) {
    openLoginModal();
    return;
  }
  const pubView = document.getElementById('publicView');
  const admView = document.getElementById('adminView');
  const navPub = document.getElementById('navPublicBtn');
  const navAdm = document.getElementById('navAdminBtn');

  if (view === 'admin') {
    pubView.classList.add('hidden');
    admView.classList.remove('hidden');
    navPub.classList.remove('active');
    navAdm.classList.add('active');
    prepareUploadDefaults();
    renderAdminPenalties();
    renderAdminWeeks();
    populateSettingsForm();
  } else {
    admView.classList.add('hidden');
    pubView.classList.remove('hidden');
    navAdm.classList.remove('active');
    navPub.classList.add('active');
    renderPublicView();
  }
  updateAdminBadge();
}

/* ==========================================================================
 * LEITURA E PRÉVIA IMEDIATA (.json, .xlsx, .xls, .csv, .tsv)
 * ========================================================================== */
function prepareUploadDefaults() {
  const dateInput = document.getElementById('uploadWeekDate');
  if (!dateInput.value) dateInput.value = todayISO();
  document.getElementById('uploadMinPoints').value = appData.settings.defaultMinPoints;
  document.getElementById('uploadMinContribution').value = appData.settings.defaultMinContribution;
}

function mapRawRowsToMembers(rawRows) {
  const parsedRows = [];
  for (const raw of rawRows) {
    if (!raw || typeof raw !== 'object') continue;
    const lowerMap = {};
    for (const [k, v] of Object.entries(raw)) {
      lowerMap[String(k).trim().toLowerCase()] = v;
    }
    const name = String(lowerMap['name'] ?? lowerMap['nome'] ?? lowerMap['jogador'] ?? '').trim();
    if (!name) continue;

    const rawStatus = String(lowerMap['status'] ?? lowerMap['estado'] ?? '').trim();
    const rawLastLogin = String(lowerMap['lastlogin'] ?? lowerMap['last_login'] ?? lowerMap['ultimo_login'] ?? '').trim();

    parsedRows.push({
      key: normalizeKey(name),
      name,
      rank: String(lowerMap['rank'] ?? lowerMap['cargo'] ?? 'Member').trim(),
      level: parseInt(lowerMap['level'] ?? lowerMap['nivel'] ?? 0, 10) || 0,
      status: rawStatus || '—',
      lastLogin: rawLastLogin || (rawStatus.toLowerCase() === 'online' ? 'Online agora' : '—'),
      points: Number(String(lowerMap['points'] ?? lowerMap['pontos'] ?? 0).replace(/,/g, '')) || 0,
      contribution: Number(String(lowerMap['contribution'] ?? lowerMap['contribuicao'] ?? 0).replace(/,/g, '')) || 0,
    });
  }
  return parsedRows;
}

function handleExcelFile(file) {
  if (!file) return;
  const fileName = (file.name || '').toLowerCase();

  // 1) Suporte nativo para JSON ({ guild, exportedAt, members: [...] })
  if (fileName.endsWith('.json')) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        let rawMembers = [];
        let exportedGuild = '';
        let exportedDate = '';

        if (Array.isArray(parsed)) {
          rawMembers = parsed;
        } else if (parsed && Array.isArray(parsed.members)) {
          rawMembers = parsed.members;
          if (parsed.guild) exportedGuild = String(parsed.guild).trim();
          if (parsed.exportedAt) {
            const match = String(parsed.exportedAt).match(/\d{4}-\d{2}-\d{2}/);
            if (match) exportedDate = match[0];
          }
        } else {
          showToast('O arquivo JSON precisa conter a lista "members" com os jogadores.', 'error');
          return;
        }

        const parsedRows = mapRawRowsToMembers(rawMembers);
        if (!parsedRows.length) {
          showToast('Nenhum jogador válido foi encontrado no JSON.', 'error');
          return;
        }

        if (exportedGuild) {
          appData.guildName = exportedGuild;
          document.getElementById('guildTitleDisplay').textContent = exportedGuild;
        }
        if (exportedDate) {
          document.getElementById('uploadWeekDate').value = exportedDate;
        }

        buildUploadPreview(parsedRows);
        showToast(`JSON carregado (${exportedGuild || appData.guildName}): ${parsedRows.length} jogadores detectados.`, 'success');
      } catch (err) {
        console.error(err);
        showToast('Erro ao ler o JSON. Verifique se o arquivo está completo e bem formatado.', 'error');
      }
    };
    reader.readAsText(file);
    return;
  }

  // 2) Suporte para Excel / CSV
  if (typeof XLSX === 'undefined') {
    showToast('Erro: não foi possível carregar o leitor de planilhas. Verifique sua conexão.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

      if (!rawRows.length) {
        showToast('O arquivo está vazio.', 'error');
        return;
      }

      const parsedRows = mapRawRowsToMembers(rawRows);
      if (!parsedRows.length) {
        showToast('Coluna "name" não encontrada no arquivo.', 'error');
        return;
      }

      buildUploadPreview(parsedRows);
      showToast(`Arquivo lido: ${parsedRows.length} jogadores detectados.`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Não foi possível ler a planilha. Verifique o formato.', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function buildUploadPreview(parsedRows) {
  const weekDate = document.getElementById('uploadWeekDate').value || todayISO();
  const weekLabel = document.getElementById('uploadWeekLabel').value.trim() || `Semana ${weekDate}`;
  const minPoints = Number(document.getElementById('uploadMinPoints').value) || 0;
  const minContribution = Number(document.getElementById('uploadMinContribution').value) || 0;

  const prevActiveKeys = new Set(
    Object.values(appData.players).filter((p) => p.active).map((p) => p.key)
  );
  const currentKeys = new Set(parsedRows.map((r) => r.key));

  const newNames = parsedRows
    .filter((r) => !appData.players[r.key] || !prevActiveKeys.has(r.key))
    .map((r) => r.name);

  const leftNames = Object.values(appData.players)
    .filter((p) => p.active && !currentKeys.has(p.key))
    .map((p) => p.name);

  const evaluatedRows = parsedRows.map((r) => {
    const existing = appData.players[r.key];
    const currentStrikes = existing ? existing.penalties.length : 0;
    const metPoints = r.points >= minPoints;
    const metContrib = r.contribution >= minContribution;
    const metGoal = metPoints && metContrib;

    const reasons = [];
    if (!metPoints) reasons.push(`Points: ${r.points}/${minPoints}`);
    if (!metContrib) reasons.push(`Contribution: ${r.contribution}/${minContribution}`);

    return {
      ...r,
      isNew: !existing,
      returned: Boolean(existing && !existing.active),
      currentStrikes,
      metGoal,
      applyPenalty: !metGoal,
      removePenalty: metGoal && currentStrikes > 0,
      penaltyReason: metGoal
        ? (currentStrikes > 0 ? 'Cumpriu a meta: reduz 1 penalidade automaticamente' : '')
        : `Não cumpriu a meta (${reasons.join(', ')})`,
    };
  });

  pendingUpload = {
    weekDate,
    weekLabel,
    minPoints,
    minContribution,
    rows: evaluatedRows,
    newNames,
    leftNames,
  };

  renderUploadPreview();
}

function reevaluatePendingGoals() {
  if (!pendingUpload) return;
  const minPoints = Number(document.getElementById('uploadMinPoints').value) || 0;
  const minContribution = Number(document.getElementById('uploadMinContribution').value) || 0;
  pendingUpload.minPoints = minPoints;
  pendingUpload.minContribution = minContribution;
  pendingUpload.weekDate = document.getElementById('uploadWeekDate').value || todayISO();
  pendingUpload.weekLabel = document.getElementById('uploadWeekLabel').value.trim() || `Semana ${pendingUpload.weekDate}`;

  pendingUpload.rows.forEach((r) => {
    const metPoints = r.points >= minPoints;
    const metContrib = r.contribution >= minContribution;
    r.metGoal = metPoints && metContrib;
    const reasons = [];
    if (!metPoints) reasons.push(`Points: ${r.points}/${minPoints}`);
    if (!metContrib) reasons.push(`Contribution: ${r.contribution}/${minContribution}`);
    r.applyPenalty = !r.metGoal;
    r.removePenalty = r.metGoal && r.currentStrikes > 0;
    r.penaltyReason = r.metGoal
      ? (r.currentStrikes > 0 ? 'Cumpriu a meta: reduz 1 penalidade automaticamente' : '')
      : `Não cumpriu a meta (${reasons.join(', ')})`;
  });

  renderUploadPreview();
}

function renderUploadPreview() {
  if (!pendingUpload) return;
  const maxStrikes = appData.settings.maxStrikes || 3;
  const section = document.getElementById('uploadPreviewSection');
  section.classList.remove('hidden');

  const { rows, newNames, leftNames } = pendingUpload;
  const metCount = rows.filter((r) => r.metGoal).length;
  const redeemCount = rows.filter((r) => r.removePenalty && r.currentStrikes > 0).length;
  const penCount = rows.filter((r) => r.applyPenalty).length;
  const reachThree = rows.filter((r) => r.applyPenalty && r.currentStrikes + 1 >= maxStrikes).length;

  document.getElementById('prevTotal').textContent = rows.length;
  document.getElementById('prevNew').textContent = newNames.length;
  document.getElementById('prevLeft').textContent = leftNames.length;
  document.getElementById('prevMet').textContent = metCount;
  const prevRedeemEl = document.getElementById('prevRedeem');
  if (prevRedeemEl) prevRedeemEl.textContent = redeemCount;
  document.getElementById('prevPenalize').textContent = penCount;
  document.getElementById('prevReachThree').textContent = reachThree;

  const changesBox = document.getElementById('rosterChangesBox');
  if (newNames.length || leftNames.length) {
    changesBox.classList.remove('hidden');
    changesBox.innerHTML = `
      ${newNames.length ? `<div>🆕 <strong>Entraram (${newNames.length}):</strong> ${newNames.map(escapeHtml).join(', ')}</div>` : ''}
      ${leftNames.length ? `<div>🚪 <strong>Saíram da guild (${leftNames.length}):</strong> ${leftNames.map(escapeHtml).join(', ')}</div>` : ''}
    `;
  } else {
    changesBox.classList.add('hidden');
  }

  const indexed = rows.map((r, idx) => ({ ...r, idx }));
  indexed.sort((a, b) => Number(a.metGoal) - Number(b.metGoal) || Number(b.removePenalty) - Number(a.removePenalty) || a.name.localeCompare(b.name, 'pt-BR'));

  const tbody = document.getElementById('previewTableBody');
  tbody.innerHTML = indexed
    .map((r) => {
      const delta = r.applyPenalty ? 1 : (r.removePenalty && r.currentStrikes > 0 ? -1 : 0);
      const nextStrikes = Math.max(0, r.currentStrikes + delta);
      const willExclude = r.applyPenalty && nextStrikes >= maxStrikes;
      const newBadge = r.isNew
        ? '<span class="badge badge-info">Novo</span>'
        : r.returned
          ? '<span class="badge badge-warning">Retornou</span>'
          : '';

      const actionCell = r.metGoal && r.currentStrikes > 0
        ? `<label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:0.78rem;color:#34d399;white-space:nowrap;">
             <input type="checkbox" ${r.removePenalty ? 'checked' : ''} onchange="togglePreviewRedeem(${r.idx}, this.checked)" />
             🕊️ -1 falta
           </label>`
        : `<label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:0.78rem;color:${r.applyPenalty ? '#f87171' : '#94a3b8'};white-space:nowrap;">
             <input type="checkbox" ${r.applyPenalty ? 'checked' : ''} onchange="togglePreviewPenalty(${r.idx}, this.checked)" />
             +1 falta
           </label>`;

      const strikesArrow = delta > 0
        ? ` → <strong style="color:${willExclude ? '#f87171' : '#fbbf24'}">${nextStrikes}/${maxStrikes}${willExclude ? ' 🚫 EXCLUIR' : ''}</strong>`
        : delta < 0
          ? ` → <strong style="color:#34d399">${nextStrikes}/${maxStrikes} 🕊️ (-1)</strong>`
          : '';

      return `
        <tr class="${willExclude ? 'row-excluded' : ''}">
          <td>${actionCell}</td>
          <td>
            <div class="player-cell">
              <span>${escapeHtml(r.name)}</span>
              ${newBadge}
            </div>
          </td>
          <td>${escapeHtml(r.rank)} · Nv.${r.level}</td>
          <td class="num">${formatNumber(r.points)}</td>
          <td class="num">${formatNumber(r.contribution)}</td>
          <td>${r.metGoal ? '<span class="badge badge-success">✅ Cumpriu</span>' : '<span class="badge badge-danger">❌ Não cumpriu</span>'}</td>
          <td>
            <span>${r.currentStrikes}/${maxStrikes}</span>${strikesArrow}
          </td>
          <td>
            <input type="text" class="note-input-sm" value="${escapeHtml(r.penaltyReason)}" placeholder="Motivo opcional..."
              onchange="updatePreviewReason(${r.idx}, this.value)" />
          </td>
        </tr>
      `;
    })
    .join('');
}

window.togglePreviewPenalty = function (idx, checked) {
  if (!pendingUpload) return;
  pendingUpload.rows[idx].applyPenalty = checked;
  if (checked) pendingUpload.rows[idx].removePenalty = false;
  if (checked && !pendingUpload.rows[idx].penaltyReason) {
    pendingUpload.rows[idx].penaltyReason = 'Penalidade semanal aplicada pela liderança';
  }
  renderUploadPreview();
};

window.togglePreviewRedeem = function (idx, checked) {
  if (!pendingUpload) return;
  pendingUpload.rows[idx].removePenalty = checked;
  if (checked) pendingUpload.rows[idx].applyPenalty = false;
  renderUploadPreview();
};

window.updatePreviewReason = function (idx, val) {
  if (!pendingUpload) return;
  pendingUpload.rows[idx].penaltyReason = val;
};

async function confirmAndSaveUpload(andPublish = false) {
  if (!pendingUpload) return;
  const weekDate = document.getElementById('uploadWeekDate').value || todayISO();
  const weekLabel = document.getElementById('uploadWeekLabel').value.trim() || `Semana ${weekDate}`;
  const weekId = `w_${weekDate}_${Date.now().toString(36)}`;

  const records = {};
  const presentKeys = new Set();

  for (const r of pendingUpload.rows) {
    presentKeys.add(r.key);
    if (!appData.players[r.key]) {
      appData.players[r.key] = {
        key: r.key,
        name: r.name,
        active: true,
        joinedAt: weekDate,
        lastKnown: {},
        penalties: [],
      };
    }

    const p = appData.players[r.key];
    p.name = r.name;
    p.active = true;
    p.lastKnown = {
      rank: r.rank,
      level: r.level,
      status: r.status,
      lastLogin: r.lastLogin,
    };

    let redeemedPenalty = false;
    if (r.applyPenalty) {
      p.penalties.push({
        id: `pen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        weekId,
        date: weekDate,
        reason: r.penaltyReason || 'Não cumpriu a meta semanal',
        by: adminSession?.role || 'Líder',
      });
    } else if (r.removePenalty && p.penalties.length > 0) {
      // Remove a penalidade mais antiga ao cumprir a meta da semana
      p.penalties.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      p.penalties.shift();
      redeemedPenalty = true;
    }

    records[r.key] = {
      name: r.name,
      rank: r.rank,
      level: r.level,
      status: r.status,
      lastLogin: r.lastLogin,
      points: r.points,
      contribution: r.contribution,
      metGoal: r.metGoal,
      penalized: r.applyPenalty,
      redeemedPenalty,
    };
  }

  for (const p of Object.values(appData.players)) {
    if (p.active && !presentKeys.has(p.key)) {
      p.active = false;
      p.leftAt = weekDate;
    }
  }

  appData.weeks.push({
    id: weekId,
    date: weekDate,
    label: weekLabel,
    minPoints: pendingUpload.minPoints,
    minContribution: pendingUpload.minContribution,
    uploadedBy: adminSession?.role || 'Líder',
    uploadedAt: new Date().toISOString(),
    newPlayers: pendingUpload.newNames,
    leftPlayers: pendingUpload.leftNames,
    records,
  });

  currentPublicWeekId = weekId;
  pendingUpload = null;
  document.getElementById('uploadPreviewSection').classList.add('hidden');
  document.getElementById('excelFileInput').value = '';

  await saveLocalData();
  renderAll();
  showToast(`Semana "${weekLabel}" salva com sucesso.`, 'success');
}

/* ==========================================================================
 * GESTÃO DE PENALIDADES E SEMANAS (ADMIN)
 * ========================================================================== */
function renderAdminPenalties() {
  const maxStrikes = appData.settings.maxStrikes || 3;
  const search = (document.getElementById('adminPenaltySearch').value || '').trim().toLowerCase();
  let players = Object.values(appData.players);

  players = players.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search)) return false;
    if (adminPenaltyFilter === 'with_strikes') return p.penalties.length > 0;
    if (adminPenaltyFilter === 'excluded') return p.penalties.length >= maxStrikes;
    if (adminPenaltyFilter === 'risk') return p.penalties.length === maxStrikes - 1;
    return true;
  });

  players.sort((a, b) => b.penalties.length - a.penalties.length || a.name.localeCompare(b.name, 'pt-BR'));

  const tbody = document.getElementById('adminPenaltiesBody');
  if (!players.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px;">Nenhum jogador nesta categoria.</td></tr>';
    return;
  }

  tbody.innerHTML = players
    .map((p) => {
      const chips = p.penalties.length
        ? `<div class="penalty-chip-list">${p.penalties
            .map((pen) => `
              <span class="penalty-chip" title="${escapeHtml(pen.reason)} (por ${escapeHtml(pen.by || 'Líder')})">
                📅 ${escapeHtml(pen.date)}
                <button onclick="removePenalty('${escapeHtml(p.key)}','${escapeHtml(pen.id)}')" title="Perdoar esta semana">Perdoar &times;</button>
              </span>
            `)
            .join('')}</div>`
        : '<span class="muted">Sem faltas</span>';

      return `
        <tr class="${p.penalties.length >= maxStrikes ? 'row-excluded' : ''}">
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td>${p.active ? '<span class="badge badge-success">Ativo</span>' : '<span class="badge badge-muted">Ex-membro</span>'}</td>
          <td>${renderStrikeIndicator(p.penalties.length, maxStrikes)}</td>
          <td>${chips}</td>
          <td>
            <div class="btn-group">
              ${p.penalties.length > 0 ? `<button class="btn btn-secondary btn-sm" onclick="forgiveOnePenalty('${escapeHtml(p.key)}')">🕊️ Perdoar 1</button>` : ''}
              <button class="btn btn-ghost btn-sm" onclick="openPlayerModal('${escapeHtml(p.key)}')">Detalhes</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

window.forgiveOnePenalty = function (playerKey) {
  const p = appData.players[playerKey];
  if (!p || !p.penalties.length) return;
  p.penalties.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const latest = p.penalties[0];
  if (!confirm(`Perdoar a penalidade de ${p.name} referente à semana ${latest.date}?`)) return;
  p.penalties.shift();
  saveLocalData();
  renderAll();
  showToast(`Penalidade de ${latest.date} perdoada para ${p.name}.`, 'success');
};

window.removePenalty = function (playerKey, penaltyId, refreshModal = false) {
  const p = appData.players[playerKey];
  if (!p) return;
  if (!confirm(`Tem certeza que deseja remover/perdoar esta penalidade de ${p.name}?`)) return;
  p.penalties = p.penalties.filter((x) => x.id !== penaltyId);
  saveLocalData();
  renderAll();
  if (refreshModal) openPlayerModal(playerKey);
  showToast(`Penalidade removida para ${p.name}.`, 'success');
};

function openManualPenaltyModal() {
  const select = document.getElementById('mpPlayerSelect');
  const players = Object.values(appData.players).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (!players.length) {
    showToast('Primeiro carregue um arquivo com os jogadores.', 'warning');
    return;
  }
  select.innerHTML = players
    .map((p) => `<option value="${escapeHtml(p.key)}">${escapeHtml(p.name)} (${p.penalties.length}/${appData.settings.maxStrikes})</option>`)
    .join('');
  document.getElementById('mpWeekDate').value = todayISO();
  document.getElementById('mpReason').value = '';
  document.getElementById('manualPenaltyModal').classList.remove('hidden');
}

function handleManualPenaltySubmit(e) {
  e.preventDefault();
  const key = document.getElementById('mpPlayerSelect').value;
  const date = document.getElementById('mpWeekDate').value;
  const reason = document.getElementById('mpReason').value.trim();
  const p = appData.players[key];
  if (!p) return;

  p.penalties.push({
    id: `pen_${Date.now().toString(36)}`,
    weekId: null,
    date,
    reason,
    by: adminSession?.role || 'Líder',
  });

  saveLocalData();
  renderAll();
  document.getElementById('manualPenaltyModal').classList.add('hidden');
  showToast(`Penalidade registrada para ${p.name} (${date}).`, 'warning');
}

function renderAdminWeeks() {
  const container = document.getElementById('weeksHistoryList');
  const sorted = [...appData.weeks].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!sorted.length) {
    container.innerHTML = '<p class="muted">Nenhuma semana registrada ainda.</p>';
    return;
  }

  container.innerHTML = sorted
    .map((w) => {
      const total = Object.keys(w.records || {}).length;
      const met = Object.values(w.records || {}).filter((r) => r.metGoal).length;
      return `
        <div class="week-item">
          <div>
            <strong>📅 ${escapeHtml(w.label || w.date)}</strong> <span class="muted">(${escapeHtml(w.date)})</span>
            <div class="muted">
              ${total} jogadores · ✅ ${met} cumpriram · Metas: Points ≥ ${w.minPoints}, Contribution ≥ ${w.minContribution} · Enviado por: ${escapeHtml(w.uploadedBy || 'Líder')}
            </div>
          </div>
          <button class="btn btn-danger-outline btn-sm" onclick="deleteWeek('${escapeHtml(w.id)}')">
            🗑️ Excluir semana
          </button>
        </div>
      `;
    })
    .join('');
}

window.deleteWeek = function (weekId) {
  const w = appData.weeks.find((x) => x.id === weekId);
  if (!w) return;
  if (!confirm(`Excluir a semana "${w.label || w.date}" e reverter as penalidades geradas nesse envio?`)) return;

  appData.weeks = appData.weeks.filter((x) => x.id !== weekId);
  for (const p of Object.values(appData.players)) {
    p.penalties = p.penalties.filter((pen) => pen.weekId !== weekId);
  }
  selectLatestWeek();
  saveLocalData();
  renderAll();
  showToast('Semana excluída.', 'info');
};

/* ==========================================================================
 * CONFIGURAÇÕES E MODELOS
 * ========================================================================== */
function populateSettingsForm() {
  document.getElementById('cfgGuildName').value = appData.guildName;
  document.getElementById('cfgDefaultPoints').value = appData.settings.defaultMinPoints;
  document.getElementById('cfgDefaultContrib').value = appData.settings.defaultMinContribution;
  document.getElementById('cfgMaxStrikes').value = appData.settings.maxStrikes;
  const keyInput = document.getElementById('syncAccessKey');
  if (keyInput) keyInput.value = getSyncKey();
}

function saveSyncKey() {
  const val = (document.getElementById('syncAccessKey')?.value || '').trim();
  if (val) {
    localStorage.setItem(SYNC_KEY_STORAGE, val);
    showToast('Chave de sincronização salva com sucesso!', 'success');
  } else {
    localStorage.removeItem(SYNC_KEY_STORAGE);
    showToast('Chave de sincronização removida.', 'info');
  }
}

async function saveGuildSettings() {
  appData.guildName = document.getElementById('cfgGuildName').value.trim() || 'Ma Vontade';
  appData.settings.defaultMinPoints = Number(document.getElementById('cfgDefaultPoints').value) || 0;
  appData.settings.defaultMinContribution = Number(document.getElementById('cfgDefaultContrib').value) || 0;
  appData.settings.maxStrikes = Math.max(1, Number(document.getElementById('cfgMaxStrikes').value) || 3);

  const newLeaderPass = document.getElementById('cfgLeaderPass').value;
  const newVicePass = document.getElementById('cfgVicePass').value;
  if (newLeaderPass) {
    appData.settings.leaderPasswordHash = sha256(newLeaderPass);
    document.getElementById('cfgLeaderPass').value = '';
  }
  if (newVicePass) {
    appData.settings.vicePasswordHash = sha256(newVicePass);
    document.getElementById('cfgVicePass').value = '';
  }

  await saveLocalData();
  renderAll();
  showToast('Configurações da guild salvas.', 'success');
}

function downloadSampleJson() {
  const sample = {
    guild: appData.guildName || 'Ma Vontade',
    exportedAt: `${todayISO()} 16:45:45`,
    members: [
      { name: 'Braya', rank: 'the Leader', level: 501, status: 'online', lastLogin: '', points: 4, contribution: 0 },
      { name: 'ViceDemo', rank: 'Vice-Leader', level: 480, status: 'online', lastLogin: '', points: 6, contribution: 120 },
      { name: 'JogadorAtivo', rank: 'Member', level: 410, status: 'offline', lastLogin: '2026-11-22 21:00', points: 5, contribution: 50 },
      { name: 'JogadorSemMeta', rank: 'Member', level: 390, status: 'offline', lastLogin: '2026-11-18 10:15', points: 1, contribution: 0 },
    ],
  };
  const blob = new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ma_vontade_${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadSampleExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('Leitor de planilhas indisponível no momento.', 'error');
    return;
  }
  const sampleRows = [
    { name: 'Braya', rank: 'the Leader', level: 501, status: 'online', lastLogin: '', points: 4, contribution: 0 },
    { name: 'ViceDemo', rank: 'Vice-Leader', level: 480, status: 'online', lastLogin: '', points: 6, contribution: 120 },
    { name: 'JogadorAtivo', rank: 'Member', level: 410, status: 'offline', lastLogin: '2026-11-22 21:00', points: 5, contribution: 50 },
    { name: 'JogadorSemMeta', rank: 'Member', level: 390, status: 'offline', lastLogin: '2026-11-18 10:15', points: 1, contribution: 0 },
  ];
  const ws = XLSX.utils.json_to_sheet(sampleRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Guild');
  XLSX.writeFile(wb, `ma_vontade_${todayISO()}.xlsx`);
}

function exportDataJson() {
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'data.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importDataJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      appData = normalizeAppData(parsed);
      selectLatestWeek();
      saveLocalData();
      renderAll();
      showToast('Backup importado com sucesso.', 'success');
    } catch {
      showToast('Arquivo JSON inválido.', 'error');
    }
  };
  reader.readAsText(file);
}

/* ==========================================================================
 * EVENT LISTENERS
 * ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('navPublicBtn').addEventListener('click', () => switchMainView('public'));
  document.getElementById('navAdminBtn').addEventListener('click', () => switchMainView('admin'));
  document.getElementById('logoutBtn').addEventListener('click', logoutAdmin);
  document.getElementById('loginForm').addEventListener('submit', handleLoginSubmit);

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.closeModal).classList.add('hidden');
    });
  });
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.add('hidden');
    });
  });

  document.getElementById('publicWeekSelect').addEventListener('change', (e) => {
    currentPublicWeekId = e.target.value;
    renderPublicView();
  });
  document.getElementById('publicSearchInput').addEventListener('input', renderPublicView);
  document.getElementById('refreshDataBtn').addEventListener('click', () => initData(true));

  document.querySelectorAll('#publicFilterPills .pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#publicFilterPills .pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      publicFilter = pill.dataset.filter;
      renderPublicView();
    });
  });

  document.querySelectorAll('#publicTable th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (publicSort.key === key) {
        publicSort.dir = publicSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        publicSort = { key, dir: key === 'name' || key === 'rank' ? 'asc' : 'desc' };
      }
      renderPublicView();
    });
  });

  document.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.adminTab;
      document.querySelectorAll('.admin-panel').forEach((p) => p.classList.add('hidden'));
      document.getElementById(`adminTab${target.charAt(0).toUpperCase() + target.slice(1)}`).classList.remove('hidden');
    });
  });

  const dropzone = document.getElementById('excelDropzone');
  const fileInput = document.getElementById('excelFileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleExcelFile(e.target.files[0]));
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleExcelFile(e.dataTransfer.files[0]);
  });

  ['uploadMinPoints', 'uploadMinContribution'].forEach((id) => {
    document.getElementById(id).addEventListener('input', reevaluatePendingGoals);
  });

  document.getElementById('cancelPreviewBtn').addEventListener('click', () => {
    pendingUpload = null;
    document.getElementById('uploadPreviewSection').classList.add('hidden');
    document.getElementById('excelFileInput').value = '';
  });
  document.getElementById('confirmUploadBtn').addEventListener('click', () => confirmAndSaveUpload());
  document.getElementById('downloadTemplateBtn').addEventListener('click', downloadSampleExcel);
  document.getElementById('downloadSampleJsonBtn').addEventListener('click', downloadSampleJson);

  document.getElementById('adminPenaltySearch').addEventListener('input', renderAdminPenalties);
  document.querySelectorAll('#adminPenaltyFilters .pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#adminPenaltyFilters .pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      adminPenaltyFilter = pill.dataset.pfilter;
      renderAdminPenalties();
    });
  });
  document.getElementById('openManualPenaltyBtn').addEventListener('click', openManualPenaltyModal);
  document.getElementById('manualPenaltyForm').addEventListener('submit', handleManualPenaltySubmit);

  document.getElementById('saveGuildSettingsBtn').addEventListener('click', saveGuildSettings);
  document.getElementById('saveSyncKeyBtn').addEventListener('click', saveSyncKey);
  document.getElementById('exportJsonBtn').addEventListener('click', exportDataJson);
  document.getElementById('importJsonInput').addEventListener('change', (e) => importDataJson(e.target.files[0]));
  document.getElementById('resetDataBtn').addEventListener('click', () => {
    if (!confirm('Tem certeza que deseja apagar todas as semanas e jogadores? Esta ação não pode ser desfeita.')) return;
    const prevSettings = appData.settings;
    appData = getDefaultData();
    appData.settings = prevSettings;
    selectLatestWeek();
    saveLocalData();
    renderAll();
    showToast('Dados limpos. Pronto para carregar seu primeiro arquivo real.', 'info');
  });

  initData();
});
