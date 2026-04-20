// ==============================================
// CatCam Dashboard v2 - Page d'accueil
// Stack : HTML + Tailwind (CDN) + Supabase JS (CDN)
// ==============================================

const SUPABASE_URL = 'https://pnkultqeijguvthjrehx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua3VsdHFlaWpndXZ0aGpyZWh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NDE4NjYsImV4cCI6MjA4NTMxNzg2Nn0.TrD_cGc-VLBfBsMVXg2rInM2LPjLyhXxZFBjHJ2MB_8';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Chat effectif : validation humaine > prediction ML
function effectiveCat(s) {
  if (s.user_validated_cat && (s.user_validated_cat === 'papouille' || s.user_validated_cat === 'tigrou')) {
    return s.user_validated_cat;
  }
  return s.cat;
}

// Baselines v0 en dur. A remplacer par calcul ±1σ sur 4 semaines en v1.
const CATS = {
  papouille: { label: 'Papouille', accent: '#7BA889', normalRange: [25, 55], hint: 'grand buveur',            photo: './assets/papouille.png' },
  tigrou:    { label: 'Tigrou',    accent: '#D9A95E', normalRange: [6, 20],  hint: 'petit buveur habituel', photo: './assets/tigrou.png' },
};

// ------- Utilitaires date / format -------

const WEEKDAYS_SHORT = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTimeRelative(iso) {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1)  return 'a l\u2019instant';
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24)   return `il y a ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  return diffD === 1 ? 'hier' : `il y a ${diffD} jours`;
}

function formatClockFR(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ------- Fetch sessions -------

async function fetchSessions() {
  // 10 jours : necessaire pour le calcul du remplissage fontaine (min/max).
  // Les cartes ne visualisent que 7j mais beneficient du buffer.
  const since = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('sessions')
    .select('*')
    .gte('start_time', since)
    .order('start_time', { ascending: false });
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data || [];
}

// ------- Stats par chat -------

function computeCatStats(sessions, catKey) {
  const todayKey = localDateKey(new Date());
  const valid = sessions.filter(s => effectiveCat(s) === catKey && !s.is_error);

  const byDay = {};
  valid.forEach(s => {
    const k = localDateKey(new Date(s.start_time));
    if (!byDay[k]) byDay[k] = { total: 0, count: 0, lastIso: null };
    byDay[k].total += Math.round(s.delta_g || 0);
    byDay[k].count += 1;
    if (!byDay[k].lastIso || s.start_time > byDay[k].lastIso) byDay[k].lastIso = s.start_time;
  });

  const values = [];
  const labels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const k = localDateKey(d);
    values.push(byDay[k]?.total || 0);
    labels.push(WEEKDAYS_SHORT[d.getDay()]);
  }

  // Moyenne journaliere : total 7j / 7 (inclut les jours sans session a 0)
  const sumWeek = values.reduce((a, b) => a + b, 0);
  const dailyAvg = Math.round(sumWeek / 7);

  // Vitesse moyenne (ml/s) : moyenne des rate_gs sur sessions valides avec rate > 0
  const ratesArr = valid
    .map(s => s.rate_gs)
    .filter(r => typeof r === 'number' && r > 0);
  const speedAvg = ratesArr.length
    ? ratesArr.reduce((a, b) => a + b, 0) / ratesArr.length
    : null;

  const today = byDay[todayKey] || { total: 0, count: 0, lastIso: null };
  return {
    todayTotal: today.total,
    todayCount: today.count,
    lastIso:    today.lastIso,
    values,
    labels,
    dailyAvg,
    speedAvg,
  };
}

// ------- Fountain fill % -------
// Bornes calibrees sur 10 jours d'historique (20/04/2026, 3206 pts de weight_curve).
// Ces constantes supposent un tare stable cote ESP32 (HX711).
// Si le tare est refait, il faudra recalibrer.
const FOUNTAIN_EMPTY_G = 1367; // "vide" = juste avant remplissage
const FOUNTAIN_FULL_G  = 2761; // "plein" = juste apres remplissage

function fillPctFromWeight(gr) {
  if (typeof gr !== 'number' || !isFinite(gr)) return null;
  const raw = ((gr - FOUNTAIN_EMPTY_G) / (FOUNTAIN_FULL_G - FOUNTAIN_EMPTY_G)) * 100;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

function lastWeightFromSession(s) {
  if (!s || !Array.isArray(s.weight_curve) || s.weight_curve.length === 0) return null;
  const g = s.weight_curve[s.weight_curve.length - 1]?.g;
  return typeof g === 'number' ? g : null;
}

function computeFountainFill(sessions) {
  // Session la plus recente ayant une weight_curve exploitable
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
  pill.title = `Fontaine ~${fill.pct}% (${Math.round(fill.current)} g | vide ${Math.round(fill.min)} g · plein ${Math.round(fill.max)} g)`;
}

// ------- Chart area (SVG gradient) -------

function niceTicks(max, targetCount = 4) {
  if (max <= 0) return [0, 1];
  const rawStep = max / (targetCount - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceSteps = [1, 2, 2.5, 5, 10];
  let step = niceSteps[niceSteps.length - 1] * pow;
  for (const s of niceSteps) {
    if (s * pow >= rawStep - 1e-9) { step = s * pow; break; }
  }
  const ticks = [];
  const tickMax = Math.ceil(max / step) * step;
  for (let v = 0; v <= tickMax + 1e-9; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

function buildAreaChart(values, labels, color, dailyAvg) {
  const W = 360, H = 140;
  // Marge large pour laisser respirer les barres sans clipping au bord
  const padL = 18, padR = 18, padT = 18, padB = 6;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = values.length;

  const dataMax = Math.max(...values, dailyAvg || 0, 1);
  const ticks = niceTicks(dataMax * 1.10, 4);
  const maxV = ticks[ticks.length - 1];
  const baseY = padT + innerH;

  const pts = values.map((v, i) => ({
    x: padL + (innerW * i) / Math.max(n - 1, 1),
    y: padT + innerH - (v / maxV) * innerH,
  }));

  // Barres fines et aerees : ~40% de l'espacement, max 22 viewBox-px
  const spacing = n > 1 ? (innerW / (n - 1)) : innerW;
  const barW    = Math.min(Math.max(spacing * 0.4, 5), 22);

  const gradId      = 'bar-' + Math.random().toString(36).slice(2, 8);
  const gradTodayId = 'today-' + Math.random().toString(36).slice(2, 8);

  const bars = pts.map((p, i) => {
    const v = values[i];
    const isToday = i === n - 1;
    if (v <= 0) {
      // Petit marqueur discret pour les jours sans boisson
      return `<circle cx="${p.x.toFixed(1)}" cy="${(baseY - 0.5).toFixed(1)}"
                      r="1.4" fill="#D9D1BE"/>`;
    }
    const h = baseY - p.y;
    const fillUrl = isToday ? `url(#${gradTodayId})` : `url(#${gradId})`;
    return `<rect x="${(p.x - barW / 2).toFixed(1)}" y="${p.y.toFixed(1)}"
                  width="${barW.toFixed(1)}" height="${h.toFixed(1)}"
                  rx="${Math.min(barW / 2, 4).toFixed(1)}" ry="${Math.min(barW / 2, 4).toFixed(1)}"
                  fill="${fillUrl}"/>`;
  }).join('');

  // Gridlines tres legers (esthetique minimaliste)
  const gridLines = ticks.map(t => {
    const y = padT + innerH - (t / maxV) * innerH;
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"
                  stroke="#E8E1D3" stroke-width="1" opacity="${t === 0 ? 0.7 : 0.3}"
                  vector-effect="non-scaling-stroke"/>`;
  }).join('');

  // Ligne moyenne journaliere (au-dessus des barres)
  const avgY = dailyAvg > 0
    ? padT + innerH - (dailyAvg / maxV) * innerH
    : null;
  const avgYPct = avgY !== null ? (avgY / H) * 100 : null;
  const avgLine = avgY !== null
    ? `<line x1="${padL}" y1="${avgY.toFixed(1)}" x2="${W - padR}" y2="${avgY.toFixed(1)}"
             stroke="#4A433A" stroke-width="1" stroke-dasharray="3 4" opacity="0.75"
             vector-effect="non-scaling-stroke"/>`
    : '';

  const yAxisHtml = ticks.map(t => {
    const yPx = padT + innerH - (t / maxV) * innerH;
    const topPct = (yPx / H) * 100;
    return `<span class="y-tick" style="top: ${topPct.toFixed(1)}%">${Math.round(t)}</span>`;
  }).join('');

  const dayLabelsHtml = pts.map((p, i) => {
    const rPct = ((W - p.x) / W) * 100;
    const isToday = i === n - 1;
    const cls  = isToday ? 'today' : '';
    const text = isToday ? 'auj' : labels[i];
    return `<span class="${cls}" style="right:${rPct.toFixed(1)}%;">${text}</span>`;
  }).join('');

  return `
    <div class="plot-row">
      <div class="y-axis">
        <span class="y-unit">ml</span>
        ${yAxisHtml}
      </div>
      <div class="chart-plot">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stop-color="${color}" stop-opacity="1"/>
              <stop offset="100%" stop-color="${color}" stop-opacity="0.55"/>
            </linearGradient>
            <linearGradient id="${gradTodayId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stop-color="#1F1B16" stop-opacity="1"/>
              <stop offset="100%" stop-color="#1F1B16" stop-opacity="0.65"/>
            </linearGradient>
          </defs>
          ${gridLines}
          ${bars}
          ${avgLine}
        </svg>
        ${avgYPct !== null ? `<div class="avg-label" style="top: ${avgYPct.toFixed(1)}%">moy. ${Math.round(dailyAvg)}</div>` : ''}
      </div>
    </div>
    <div class="day-labels">${dayLabelsHtml}</div>
  `;
}

// ------- Rendu carte chat -------

function buildCatCard(catKey, stats) {
  const cfg = CATS[catKey];
  const [lo, hi] = cfg.normalRange;

  let subText, subDotCls;
  if (stats.todayCount === 0) {
    subText = `Pas encore venu aujourd\u2019hui · ${cfg.hint}`;
    subDotCls = 'off';
  } else if (stats.todayTotal > hi) {
    subText = `Au-dessus de la norme · ${cfg.hint}`;
    subDotCls = 'watch';
  } else if (stats.todayTotal < lo) {
    subText = `Un peu bas · ${cfg.hint}`;
    subDotCls = 'watch';
  } else {
    subText = `Dans la norme · ${cfg.hint}`;
    subDotCls = '';
  }

  const sessionsStr = stats.todayCount === 0
    ? 'aucune session'
    : stats.todayCount === 1 ? '1 session' : `${stats.todayCount} sessions`;
  const lastStr = stats.lastIso ? formatTimeRelative(stats.lastIso) : '—';

  const avatarStyle = cfg.photo
    ? `background-image:url('${cfg.photo}');`
    : '';

  const metaText = stats.lastIso
    ? `${sessionsStr} · <b>${lastStr}</b>`
    : sessionsStr;

  return `
    <a class="cat-card" href="chat.html?id=${catKey}">
      <div class="cat-head">
        <div class="cat-head-left">
          <div class="cat-avatar" style="${avatarStyle}" role="img" aria-label="Photo ${cfg.label}"></div>
          <div class="min-w-0">
            <p class="cat-name">${cfg.label}</p>
            <p class="cat-sub"><span class="dot ${subDotCls}"></span>${subText}</p>
          </div>
        </div>
        <div class="cat-value">
          <div><span class="num">${stats.todayTotal}</span><span class="unit">ml</span></div>
          <div class="label">Aujourd'hui</div>
        </div>
      </div>

      <div class="cat-body">
        <div class="chart-wrap">${buildAreaChart(stats.values, stats.labels, cfg.accent, stats.dailyAvg)}</div>
      </div>

      <div class="cat-meta">
        <span>${metaText}</span>
        <svg class="cat-chevron-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </a>
  `;
}

function renderCats(sessions) {
  const container = document.getElementById('cats-container');
  const statsByKey = {};
  let html = '';
  for (const k of Object.keys(CATS)) {
    statsByKey[k] = computeCatStats(sessions, k);
    html += buildCatCard(k, statsByKey[k]);
  }
  container.innerHTML = html;
  return statsByKey;
}

// ------- Sessions des dernieres 24h -------

function renderRecentSessions(sessions) {
  const list     = document.getElementById('recent-list');
  const countEl  = document.getElementById('recent-count');
  const cutoff   = Date.now() - 24 * 60 * 60 * 1000;

  const recent = sessions
    .filter(s => !s.is_error && new Date(s.start_time).getTime() >= cutoff)
    .sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

  countEl.textContent = recent.length ? `(${recent.length})` : '';

  if (recent.length === 0) {
    list.innerHTML = `<div class="recent-empty">Aucune session dans les 24 dernieres heures</div>`;
    return;
  }

  list.innerHTML = recent.map(s => {
    const effCat = effectiveCat(s);
    const catLabel = CATS[effCat]?.label || effCat || '?';
    const delta = Math.round(s.delta_g || 0);
    const coverStyle = s.cover_url ? `background-image:url('${s.cover_url}')` : '';
    const href = `./timeline.html?session=${encodeURIComponent(s.id)}`;
    return `
      <a class="recent-item" href="${href}">
        <div class="ls-cover" style="${coverStyle}"></div>
        <div class="flex-1 min-w-0">
          <p class="ls-title truncate">${catLabel} · ${delta} ml</p>
          <p class="ls-sub">${formatClockFR(s.start_time)} · ${formatTimeRelative(s.start_time)}</p>
        </div>
        <div class="ls-chev">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </a>
    `;
  }).join('');
}

// ------- Footer info -------

function renderFooter(sessions) {
  document.getElementById('footer-info').textContent =
    `${sessions.length} sessions sur 7 jours · maj ${formatClockFR(new Date().toISOString())}`;
}

// ------- Boot -------

// Realtime : mise a jour du % fontaine a chaque nouvelle session Supabase
function subscribeToNewSessions(onNew) {
  const channel = sb.channel('dashboard-v2-sessions')
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sessions' },
        (payload) => { if (payload?.new) onNew(payload.new); })
    .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions' },
        (payload) => { if (payload?.new) onNew(payload.new); })
    .subscribe();
  return channel;
}

async function main() {
  try {
    const sessions = await fetchSessions();
    renderCats(sessions);
    renderFountainPill(computeFountainFill(sessions));
    renderRecentSessions(sessions);
    renderFooter(sessions);

    // Sur chaque nouveau cluster : reactualise le % fontaine
    let latestKnownTime = sessions.reduce((m, s) => Math.max(m, new Date(s.start_time).getTime()), 0);
    subscribeToNewSessions((row) => {
      const t = new Date(row.start_time).getTime();
      if (t < latestKnownTime) return; // anciennete : ignore
      latestKnownTime = t;
      const current = lastWeightFromSession(row);
      const pct = fillPctFromWeight(current);
      if (pct !== null) {
        renderFountainPill({ pct, current, min: FOUNTAIN_EMPTY_G, max: FOUNTAIN_FULL_G });
      }
    });
  } catch (e) {
    console.error(e);
    document.getElementById('footer-info').textContent = `Erreur: ${e.message}`;
  }
}

main();
