// ==============================================
// CatCam Dashboard v2 - Page profil chat
// ==============================================

const SUPABASE_URL = 'https://pnkultqeijguvthjrehx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua3VsdHFlaWpndXZ0aGpyZWh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NDE4NjYsImV4cCI6MjA4NTMxNzg2Nn0.TrD_cGc-VLBfBsMVXg2rInM2LPjLyhXxZFBjHJ2MB_8';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CATS = {
  papouille: { label: 'Papouille', accent: '#7BA889', normalRange: [25, 55] },
  tigrou:    { label: 'Tigrou',    accent: '#D9A95E', normalRange: [6, 20] },
};

const FOUNTAIN_EMPTY_G = 1367;
const FOUNTAIN_FULL_G  = 2761;

const MONTHS_SHORT = ['jan','fev','mar','avr','mai','jun','jul','aou','sep','oct','nov','dec'];

// ------- State -------
const state = {
  currentCat: 'papouille',
  period: 7,           // 30 | 7 | 0 (tout, pas encore implemente)
  sessions: [],
};

// ------- Utilitaires -------

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDurationMMSS(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function std(arr, mean) {
  if (!arr.length) return 0;
  const v = arr.reduce((s, x) => s + (x - mean) * (x - mean), 0) / arr.length;
  return Math.sqrt(v);
}

// ------- Fetch sessions (31 jours pour couvrir periode 30j) -------

async function fetchSessions() {
  const since = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('sessions')
    .select('*')
    .gte('start_time', since)
    .order('start_time', { ascending: false });
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data || [];
}

// ------- Fountain fill (dup simplifiee de app.js) -------

function fillPctFromWeight(g) {
  if (typeof g !== 'number' || !isFinite(g)) return null;
  const raw = ((g - FOUNTAIN_EMPTY_G) / (FOUNTAIN_FULL_G - FOUNTAIN_EMPTY_G)) * 100;
  return Math.round(Math.max(0, Math.min(100, raw)));
}
function lastWeightFromSession(s) {
  if (!s || !Array.isArray(s.weight_curve) || s.weight_curve.length === 0) return null;
  const g = s.weight_curve[s.weight_curve.length - 1]?.g;
  return typeof g === 'number' ? g : null;
}
function computeFountainFill(sessions) {
  let latest = null, latestTime = 0;
  for (const s of sessions) {
    if (!Array.isArray(s.weight_curve) || s.weight_curve.length === 0) continue;
    const t = new Date(s.start_time).getTime();
    if (t > latestTime) { latestTime = t; latest = s; }
  }
  const current = lastWeightFromSession(latest);
  const pct = fillPctFromWeight(current);
  if (pct === null) return null;
  return { pct, current, min: FOUNTAIN_EMPTY_G, max: FOUNTAIN_FULL_G };
}
function renderFountainPill(fill) {
  const pill = document.getElementById('fountain-pill');
  const txt  = document.getElementById('fountain-pct-text');
  if (!fill) { pill.style.display = 'none'; return; }
  pill.style.display = 'inline-flex';
  txt.textContent = `${fill.pct}%`;
  pill.classList.remove('low', 'empty');
  if (fill.pct < 15)       pill.classList.add('empty');
  else if (fill.pct < 30)  pill.classList.add('low');
  pill.title = `Fontaine ~${fill.pct}% (${Math.round(fill.current)} g)`;
}

// ------- Stats -------

function computeProfileStats(sessions, catKey, periodDays) {
  const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const valid = sessions.filter(s =>
    s.cat === catKey && !s.is_error && new Date(s.start_time).getTime() >= cutoff
  );

  // Aggregation par jour (volume + count)
  const byDay = {};
  valid.forEach(s => {
    const k = localDateKey(new Date(s.start_time));
    if (!byDay[k]) byDay[k] = { total: 0, count: 0 };
    byDay[k].total += Math.round(s.delta_g || 0);
    byDay[k].count += 1;
  });

  // Reconstitution des N jours (y compris ceux sans session = 0)
  const allDayKeys = [];
  const dailyVolumes = [];
  const dailyCounts  = [];
  for (let i = periodDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const k = localDateKey(d);
    allDayKeys.push(k);
    dailyVolumes.push(byDay[k]?.total || 0);
    dailyCounts.push(byDay[k]?.count || 0);
  }

  // Metriques
  const totalVol = dailyVolumes.reduce((a, b) => a + b, 0);
  const volumeAvg = totalVol / periodDays;
  const volumeStd = std(dailyVolumes, volumeAvg);

  const durations = valid.map(s => s.duration_s).filter(d => typeof d === 'number' && d > 0);
  const durationAvg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const durationStd = std(durations, durationAvg);

  const rates = valid.map(s => s.rate_gs).filter(r => typeof r === 'number' && r > 0);
  const rateMedian = median(rates);

  const sessionsAvg = dailyCounts.reduce((a, b) => a + b, 0) / periodDays;
  const sessionsStd = std(dailyCounts, sessionsAvg);

  // Heatmap horaire (somme sur toute la periode)
  const hourly = new Array(24).fill(0);
  valid.forEach(s => {
    const h = new Date(s.start_time).getHours();
    hourly[h] += 1;
  });

  return {
    volumeAvg, volumeStd,
    durationAvg, durationStd,
    rateMedian,
    sessionsAvg, sessionsStd,
    dailyVolumes,
    hourly,
    totalSessions: valid.length,
    periodDays,
  };
}

// ------- Verdict helpers -------

function verdictVolume(cfg, avg) {
  const [lo, hi] = cfg.normalRange;
  if (avg < lo * 0.5) return { cls: 'alert', text: 'tres bas' };
  if (avg < lo)        return { cls: 'watch', text: 'un peu bas' };
  if (avg > hi * 1.3) return { cls: 'alert', text: 'eleve' };
  if (avg > hi)        return { cls: 'watch', text: 'au-dessus' };
  return { cls: '', text: 'normal' };
}

// ------- Rendu stats cards -------

function renderStatsCards(stats, cfg) {
  const volV = verdictVolume(cfg, stats.volumeAvg);
  document.getElementById('stat-volume').innerHTML = `${Math.round(stats.volumeAvg)}<span class="u">ml</span>`;
  const volVerdict = document.getElementById('stat-volume-verdict');
  volVerdict.textContent = `±${Math.round(stats.volumeStd)} ml · ${volV.text}`;
  volVerdict.className = `verdict ${volV.cls}`;

  document.getElementById('stat-duration').textContent = formatDurationMMSS(stats.durationAvg);
  document.getElementById('stat-duration-verdict').textContent =
    stats.durationAvg > 0 ? `±${Math.round(stats.durationStd)}s · normal` : '—';

  document.getElementById('stat-rate').innerHTML = stats.rateMedian > 0
    ? `${stats.rateMedian.toFixed(2)}<span class="u">ml/s</span>`
    : `—<span class="u"></span>`;
  document.getElementById('stat-rate-verdict').textContent = stats.rateMedian > 0 ? 'stable' : '—';

  document.getElementById('stat-sessions').textContent = stats.sessionsAvg.toFixed(1);
  document.getElementById('stat-sessions-verdict').textContent =
    stats.sessionsAvg > 0 ? `±${stats.sessionsStd.toFixed(1)} · normal` : '—';
}

// ------- Rendu chart (meme DA / meme methode que l'accueil) -------

const WEEKDAYS_SHORT = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

// Ticks arrondis pour l'axe Y (ex: 0, 20, 40, 60 ml)
function niceTicksMl(max, target = 4) {
  if (max <= 0) return [0, 1];
  const rawStep = max / (target - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const nice = [1, 2, 2.5, 5, 10];
  let step = nice[nice.length - 1] * pow;
  for (const s of nice) {
    if (s * pow >= rawStep - 1e-9) { step = s * pow; break; }
  }
  const ticks = [];
  const tickMax = Math.ceil(max / step) * step;
  for (let v = 0; v <= tickMax + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

function buildPeriodLabels(periodDays) {
  const labels = [];
  const step = periodDays <= 7 ? 1 : Math.ceil(periodDays / 6);
  for (let i = periodDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const isToday = i === 0;
    if (isToday)                         labels.push('auj');
    else if (periodDays <= 7)            labels.push(WEEKDAYS_SHORT[d.getDay()]);
    else if (i % step === 0)             labels.push(`${d.getDate()}/${d.getMonth() + 1}`);
    else                                 labels.push('');
  }
  return labels;
}

function buildAreaChart(values, labels, color, dailyAvg) {
  const W = 360, H = 140;
  const padL = 6, padR = 6, padT = 18, padB = 6;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = values.length;

  const dataMax = Math.max(...values, dailyAvg || 0, 1);
  const ticks   = niceTicksMl(dataMax * 1.10, 4);
  const maxV    = ticks[ticks.length - 1];

  const pts = values.map((v, i) => ({
    x: padL + (innerW * i) / Math.max(n - 1, 1),
    y: padT + innerH - (v / maxV) * innerH,
  }));

  // Catmull-Rom smooth
  function smoothPath(p) {
    if (p.length < 2) return '';
    let d = `M${p[0].x.toFixed(1)},${p[0].y.toFixed(1)}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i];
      const p1 = p[i];
      const p2 = p[i + 1];
      const p3 = p[i + 2] || p2;
      const t = 0.2;
      const c1x = p1.x + (p2.x - p0.x) * t;
      const c1y = p1.y + (p2.y - p0.y) * t;
      const c2x = p2.x - (p3.x - p1.x) * t;
      const c2y = p2.y - (p3.y - p1.y) * t;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  }

  const linePath = smoothPath(pts);
  const baseY    = padT + innerH;
  const areaPath = linePath + ` L${pts[n - 1].x.toFixed(1)},${baseY} L${pts[0].x.toFixed(1)},${baseY} Z`;

  // Gridlines
  const gridLines = ticks.map(t => {
    const y = padT + innerH - (t / maxV) * innerH;
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"
                  stroke="#E8E1D3" stroke-width="1" opacity="${t === 0 ? 0.9 : 0.55}"
                  vector-effect="non-scaling-stroke"/>`;
  }).join('');

  // Ligne moyenne
  const avgY = dailyAvg > 0 ? padT + innerH - (dailyAvg / maxV) * innerH : null;
  const avgYPct = avgY !== null ? (avgY / H) * 100 : null;
  const avgLine = avgY !== null
    ? `<line x1="${padL}" y1="${avgY.toFixed(1)}" x2="${W - padR}" y2="${avgY.toFixed(1)}"
             stroke="#4A433A" stroke-width="1" stroke-dasharray="3 4" opacity="0.75"
             vector-effect="non-scaling-stroke"/>`
    : '';

  // Y axis HTML
  const yAxisHtml = ticks.map(t => {
    const yPx = padT + innerH - (t / maxV) * innerH;
    const topPct = (yPx / H) * 100;
    return `<span class="y-tick" style="top: ${topPct.toFixed(1)}%">${Math.round(t)}</span>`;
  }).join('');

  // Day labels (memes positions right% que les dots)
  const dayLabelsHtml = pts.map((p, i) => {
    const rPct = ((W - p.x) / W) * 100;
    const isToday = i === n - 1;
    const cls  = isToday ? 'today' : '';
    const text = labels[i] || '';
    return `<span class="${cls}" style="right:${rPct.toFixed(1)}%;">${text}</span>`;
  }).join('');

  const gradId = 'grad-' + Math.random().toString(36).slice(2, 8);

  // Dots : tous les jours si periode <= 7, sinon juste today
  const showAllDots = n <= 7;
  const dotsHtml = pts.map((p, i) => {
    const isToday = i === n - 1;
    if (!isToday && !showAllDots) return '';
    const rPct = ((W - p.x) / W) * 100;
    const tPct = (p.y / H) * 100;
    const fill = isToday ? '#1F1B16' : color;
    const cls  = isToday ? 'day-dot today' : 'day-dot';
    return `<div class="${cls}" style="right:${rPct.toFixed(1)}%;top:${tPct.toFixed(1)}%;background:${fill};"></div>`;
  }).join('');

  return `
    <div class="plot-row">
      <div class="y-axis">
        <span class="y-unit">ml</span>
        ${yAxisHtml}
      </div>
      <div class="chart-column">
        <div class="chart-plot">
          <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="${gradId}" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%"   stop-color="${color}" stop-opacity="0.35"/>
                <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
              </linearGradient>
            </defs>
            ${gridLines}
            <path d="${areaPath}" fill="url(#${gradId})"/>
            ${avgLine}
            <path d="${linePath}" stroke="${color}" stroke-width="2.2" fill="none"
                  stroke-linecap="round" stroke-linejoin="round"
                  vector-effect="non-scaling-stroke"/>
          </svg>
          ${dotsHtml}
          ${avgYPct !== null ? `<div class="avg-label" style="top: ${avgYPct.toFixed(1)}%">moy. ${Math.round(dailyAvg)}</div>` : ''}
        </div>
        <div class="day-labels">${dayLabelsHtml}</div>
      </div>
    </div>
  `;
}

function renderVolumeChart(stats, cfg) {
  const el = document.getElementById('volume-chart');
  const values = stats.dailyVolumes;
  const labels = buildPeriodLabels(state.period);
  el.innerHTML = buildAreaChart(values, labels, cfg.accent, stats.volumeAvg);
  document.getElementById('chart-title').textContent = `Volume sur ${state.period} jours`;
}

// ------- Rendu heatmap 24h -------

function renderHeatmap(stats, cfg) {
  const grid = document.getElementById('heatmap-grid');
  const max = Math.max(...stats.hourly, 1);
  grid.innerHTML = stats.hourly.map((count, h) => {
    const opacity = count === 0 ? 0.08 : (0.15 + 0.85 * (count / max));
    const bg = count === 0 ? '#E8E1D3' : cfg.accent;
    const tooltip = `${h}h — ${count} session${count > 1 ? 's' : ''}`;
    return `<div class="heatmap-cell" style="background:${bg};opacity:${opacity.toFixed(2)};" title="${tooltip}"></div>`;
  }).join('');
}

// ------- Selector / tabs state -------

function updateCatSelector() {
  document.querySelectorAll('.cat-pick').forEach(el => {
    const isActive = el.dataset.cat === state.currentCat;
    el.classList.toggle('active', isActive);
    el.classList.toggle('inactive', !isActive);
    el.style.borderColor = isActive ? CATS[el.dataset.cat].accent : 'transparent';
  });
}

function updatePeriodTabs() {
  document.querySelectorAll('.period-tab').forEach(el => {
    const p = parseInt(el.dataset.period);
    el.classList.toggle('active', p === state.period);
  });
}

// ------- Render global -------

function renderProfile() {
  const cfg = CATS[state.currentCat];
  const stats = computeProfileStats(state.sessions, state.currentCat, state.period);
  updateCatSelector();
  updatePeriodTabs();
  renderStatsCards(stats, cfg);
  renderVolumeChart(stats, cfg);
  renderHeatmap(stats, cfg);
  document.getElementById('session-count').textContent =
    `${stats.totalSessions} session${stats.totalSessions > 1 ? 's' : ''}`;
  document.getElementById('ai-period-sub').textContent =
    state.period === 30 ? 'Derniers 30 jours'
    : state.period === 7 ? 'Derniers 7 jours'
    : 'Depuis le debut';
}

// ------- Events -------

function initEvents() {
  document.querySelectorAll('.cat-pick').forEach(el => {
    el.addEventListener('click', () => {
      const newCat = el.dataset.cat;
      if (newCat === state.currentCat) return;
      state.currentCat = newCat;
      const url = new URL(window.location.href);
      url.searchParams.set('id', newCat);
      history.replaceState({}, '', url);
      renderProfile();
    });
  });

  document.querySelectorAll('.period-tab').forEach(el => {
    el.addEventListener('click', () => {
      if (el.disabled) return;
      const p = parseInt(el.dataset.period);
      if (p === 0 || p === state.period) return;
      state.period = p;
      renderProfile();
    });
  });
}

// ------- Boot -------

async function main() {
  // Parse URL ?id=papouille|tigrou
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  if (idParam === 'papouille' || idParam === 'tigrou') {
    state.currentCat = idParam;
  }

  initEvents();
  updateCatSelector();
  updatePeriodTabs();

  try {
    state.sessions = await fetchSessions();
    renderProfile();
    renderFountainPill(computeFountainFill(state.sessions));
  } catch (e) {
    console.error(e);
    document.getElementById('session-count').textContent = `Erreur : ${e.message}`;
  }
}

main();
