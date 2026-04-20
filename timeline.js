// ==============================================
// CatCam Dashboard v2 - Page Timeline (14 jours)
// ==============================================

const SUPABASE_URL = 'https://pnkultqeijguvthjrehx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua3VsdHFlaWpndXZ0aGpyZWh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3NDE4NjYsImV4cCI6MjA4NTMxNzg2Nn0.TrD_cGc-VLBfBsMVXg2rInM2LPjLyhXxZFBjHJ2MB_8';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CATS = {
  papouille: { label: 'Papouille', accent: '#7BA889', photo: './assets/papouille.png' },
  tigrou:    { label: 'Tigrou',    accent: '#D9A95E', photo: './assets/tigrou.png' },
};

const FOUNTAIN_EMPTY_G = 1367;
const FOUNTAIN_FULL_G  = 2761;

const WEEKDAYS_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
                'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

let allSessions = [];

// ------- Utilitaires -------

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatClock(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDurationMMSS(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDayLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysDiff = Math.round((today.getTime() - date.getTime()) / 86400000);
  if (daysDiff === 0) return 'Aujourd\u2019hui';
  if (daysDiff === 1) return 'Hier';
  return `${WEEKDAYS_FULL[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

// ------- Fetch -------

async function fetchSessions(days = 14) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('sessions')
    .select('*')
    .gte('start_time', since)
    .order('start_time', { ascending: false });
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data || [];
}

// ------- Fountain fill -------

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
function renderFountainPill(sessions) {
  let latest = null, latestTime = 0;
  for (const s of sessions) {
    if (!Array.isArray(s.weight_curve) || s.weight_curve.length === 0) continue;
    const t = new Date(s.start_time).getTime();
    if (t > latestTime) { latestTime = t; latest = s; }
  }
  const current = lastWeightFromSession(latest);
  const pct = fillPctFromWeight(current);
  const pill = document.getElementById('fountain-pill');
  const txt  = document.getElementById('fountain-pct-text');
  if (pct === null) { pill.style.display = 'none'; return; }
  pill.style.display = 'inline-flex';
  txt.textContent = `${pct}%`;
  pill.classList.remove('low', 'empty');
  if (pct < 15)       pill.classList.add('empty');
  else if (pct < 30)  pill.classList.add('low');
  pill.title = `Fontaine ~${pct}% (${Math.round(current)} g)`;
}

// ------- Timeline rendering -------

function renderTimeline(sessions) {
  const container = document.getElementById('timeline-list');
  // Ignore erreurs balance
  const visible = sessions.filter(s => !s.is_error);

  if (visible.length === 0) {
    container.innerHTML = `<div class="empty-state">Aucune session sur les 14 derniers jours</div>`;
    document.getElementById('tl-sub').textContent = '14 derniers jours';
    return;
  }

  // Group by day
  const byDay = {};
  visible.forEach(s => {
    const k = localDateKey(new Date(s.start_time));
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push(s);
  });

  // Sort days DESC
  const sortedKeys = Object.keys(byDay).sort((a, b) => b.localeCompare(a));

  container.innerHTML = sortedKeys.map(key => {
    const items = byDay[key];
    items.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
    const rows = items.map(s => buildSessionRow(s)).join('');
    return `
      <div class="day-group">
        <div class="day-head">
          <span class="day-label">${formatDayLabel(key)}</span>
          <span class="day-count">${items.length} session${items.length > 1 ? 's' : ''}</span>
        </div>
        <div class="day-card">${rows}</div>
      </div>
    `;
  }).join('');

  // Wire click handlers
  container.querySelectorAll('.session-row').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const s = sessions.find(x => x.id === id);
      if (s) openSheet(s);
    });
  });

  document.getElementById('tl-sub').textContent =
    `${visible.length} session${visible.length > 1 ? 's' : ''} · 14 derniers jours`;
}

function buildSessionRow(s) {
  const cfg = CATS[s.cat];
  const catName = cfg?.label || (s.cat === 'incertain' ? 'Incertain' : (s.cat || '?'));
  const avatar = cfg?.photo
    ? `<div class="session-avatar" style="background-image:url('${cfg.photo}')"></div>`
    : `<div class="session-avatar">?</div>`;
  const delta = Math.round(s.delta_g || 0);
  const dur   = formatDurationMMSS(s.duration_s);
  const cls   = s.cat === 'incertain' ? 'session-row incertain' : 'session-row';
  return `
    <button class="${cls}" data-id="${s.id}" aria-label="Ouvrir session ${catName} ${formatClock(s.start_time)}">
      <span class="session-time">${formatClock(s.start_time)}</span>
      ${avatar}
      <div class="session-body">
        <div class="session-name">${catName}</div>
        <div class="session-meta"><b>${delta} ml</b> · ${dur}</div>
      </div>
      <svg class="session-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
  `;
}

// ------- Bottom sheet : session detail -------

function openSheet(s) {
  const container = document.getElementById('sheet-container');
  const content   = document.getElementById('sheet-content');
  content.innerHTML = buildSheetContent(s);
  container.classList.add('open');
  container.setAttribute('aria-hidden', 'false');
  wireSheetEvents(s);
  // Draw weight chart after DOM injection
  const curveEl = document.getElementById('weight-chart-svg');
  if (curveEl) curveEl.innerHTML = buildWeightChartSvg(s);
  // Titre de duree boisson (au-dessus du chart, style matplotlib)
  const durEl = document.getElementById('weight-card-dur');
  if (durEl) {
    const zone = computeDrinkingZone(s.weight_curve, s.drinking_duration_s);
    if (zone) {
      const d = Math.round(zone.endSec - zone.startSec);
      durEl.textContent = `boisson : ${Math.round(zone.startSec)}s → ${Math.round(zone.endSec)}s (${d}s)`;
    } else {
      durEl.textContent = '';
    }
  }
}

function closeSheet() {
  const container = document.getElementById('sheet-container');
  container.classList.remove('open');
  container.setAttribute('aria-hidden', 'true');
}

function dayLabelFromSession(s) {
  const k = localDateKey(new Date(s.start_time));
  return formatDayLabel(k).toLowerCase();
}

function buildSheetContent(s) {
  const cfg = CATS[s.cat];
  const catLabel = cfg?.label || (s.cat === 'incertain' ? 'Incertain' : (s.cat || '?'));
  const certainty = (s.certainty || '').toLowerCase();
  const certClass = ['high','med','low'].includes(certainty) ? certainty : 'low';
  const certText  = (s.certainty || '—').toUpperCase();

  const delta = Math.round(s.delta_g || 0);
  const dur   = formatDurationMMSS(s.duration_s);
  const rate  = typeof s.rate_gs === 'number' && s.rate_gs > 0 ? s.rate_gs.toFixed(2) : '—';

  const timelapse = s.video_url
    ? `<img src="${s.video_url}" alt="timelapse ${catLabel}" />`
    : (s.cover_url
        ? `<img src="${s.cover_url}" alt="cover ${catLabel}" />`
        : `<span>Pas de media</span>`);

  const durBadge = s.duration_s > 0
    ? `<div class="timelapse-duration">${formatDurationMMSS(s.duration_s)}</div>`
    : '';

  return `
    <div class="sheet-head">
      <button class="sheet-back" id="sheet-back-btn" aria-label="Retour">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <div class="sheet-head-text">
        <div class="sheet-title">Session · ${catLabel}</div>
        <div class="sheet-subtitle">${dayLabelFromSession(s)} · ${formatClock(s.start_time)}</div>
      </div>
      <span class="cert-badge ${certClass}">${certText}</span>
    </div>

    <div class="sheet-body">
      <div class="timelapse-wrap">
        ${timelapse}
        ${durBadge}
      </div>

      <div class="sheet-stats">
        <div class="sheet-stat">
          <div class="sheet-stat-value">${delta}<span class="u">ml</span></div>
          <div class="sheet-stat-label">volume</div>
        </div>
        <div class="sheet-stat">
          <div class="sheet-stat-value">${dur}</div>
          <div class="sheet-stat-label">duree</div>
        </div>
        <div class="sheet-stat">
          <div class="sheet-stat-value">${rate}<span class="u">ml/s</span></div>
          <div class="sheet-stat-label">rythme</div>
        </div>
      </div>

      <div class="weight-card">
        <div class="weight-card-head">
          <span class="weight-card-title">Consommation cumulee</span>
          <span class="weight-card-dur" id="weight-card-dur"></span>
        </div>
        <div class="weight-chart" id="weight-chart-svg"></div>
        <div class="weight-legend">
          <span class="item"><span class="swatch line" style="background:${CATS[s.cat]?.accent || '#7BA889'};"></span>ml consommes</span>
          <span class="item"><span class="swatch zone"></span>Boisson active</span>
        </div>
      </div>

      ${buildValidationBlock(s)}
    </div>
  `;
}

function buildValidationBlock(s) {
  // Deja valide par l'utilisateur
  if (s.user_validated_cat) {
    return `
      <div class="validation-card validation-done">
        <div class="title">Valide</div>
        <div class="sub">Tu as confirme que c'est <b>${s.user_validated_cat}</b>.</div>
      </div>
    `;
  }
  // Incertain → proposer validation
  if (s.cat === 'incertain') {
    return `
      <div class="validation-card" id="validation-box">
        <div class="validation-q">C'est bien quel chat ?</div>
        <div class="validation-grid">
          <button class="vbtn primary" data-cat="papouille">Papouille</button>
          <button class="vbtn amber"   data-cat="tigrou">Tigrou</button>
          <button class="vbtn"         data-cat="unsure">Je sais pas</button>
          <button class="vbtn"         data-cat="not_cat">Pas un chat</button>
        </div>
      </div>
    `;
  }
  // Session confiante (high / med): pas de CTA de validation
  return '';
}

function wireSheetEvents(s) {
  document.getElementById('sheet-back-btn').addEventListener('click', closeSheet);
  const validBox = document.getElementById('validation-box');
  if (validBox) {
    validBox.querySelectorAll('.vbtn').forEach(btn => {
      btn.addEventListener('click', () => submitValidation(s, btn.dataset.cat, validBox));
    });
  }
}

async function submitValidation(s, chosen, box) {
  box.querySelectorAll('.vbtn').forEach(b => b.disabled = true);
  // Mapping UI -> colonne cat
  const catUpdate = (chosen === 'unsure' || chosen === 'not_cat') ? s.cat : chosen;
  const { error } = await sb
    .from('sessions')
    .update({
      cat: catUpdate,
      user_validated_cat: chosen,
      user_validated_at: new Date().toISOString(),
    })
    .eq('id', s.id);

  if (error) {
    box.innerHTML = `<div class="validation-q" style="color:#8C4343;">Erreur : ${error.message}</div>`;
    return;
  }
  box.className = 'validation-card validation-done';
  box.innerHTML = `
    <div class="title">Merci !</div>
    <div class="sub">Valide comme <b>${chosen}</b>. La session sera integree au prochain reentrainement.</div>
  `;
  // Met a jour la session en memoire
  s.user_validated_cat = chosen;
  s.cat = catUpdate;
}

// Fermeture modale : backdrop + Esc + swipe-down
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
  enableSheetDrag();
});

// --- Swipe down to dismiss ---
function enableSheetDrag() {
  const sheet     = document.getElementById('sheet');
  const backdrop  = document.getElementById('sheet-backdrop');
  const container = document.getElementById('sheet-container');
  if (!sheet || !backdrop || !container) return;

  let pendingDrag   = false;
  let isDragging    = false;
  let startY        = 0;
  let delta         = 0;
  let activePointer = null;
  let lastY         = 0;
  let lastTime      = 0;
  let velocity      = 0;                      // px/ms (positif = vers le bas)
  const INTENT_PX   = 6;

  sheet.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // On ne prend le controle que si la modale est deja remontee au top
    if (sheet.scrollTop > 0) return;
    pendingDrag = true;
    isDragging  = false;
    startY      = e.clientY;
    lastY       = e.clientY;
    lastTime    = performance.now();
    velocity    = 0;
    delta       = 0;
    activePointer = e.pointerId;
  });

  sheet.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer) return;
    const d = e.clientY - startY;

    if (pendingDrag && !isDragging) {
      if (Math.abs(d) < INTENT_PX) return;
      if (d < 0) {                    // swipe vers le haut : on abandonne, on laisse le scroll natif
        pendingDrag = false;
        return;
      }
      // Intent downward : on engage
      pendingDrag = false;
      isDragging  = true;
      sheet.style.transition    = 'none';
      backdrop.style.transition = 'none';
      try { sheet.setPointerCapture(e.pointerId); } catch (err) {}
    }

    if (isDragging) {
      delta = Math.max(0, d);
      sheet.style.transform = `translateY(${delta}px)`;
      const fade = Math.max(0, 1 - (delta / sheet.offsetHeight) * 1.3);
      backdrop.style.opacity = String(fade);
      // Velocite instantanee (px/ms)
      const now = performance.now();
      const dt  = now - lastTime;
      if (dt > 0) velocity = (e.clientY - lastY) / dt;
      lastY    = e.clientY;
      lastTime = now;
    }
  });

  function endDrag(e) {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    pendingDrag   = false;
    if (!isDragging) return;
    isDragging = false;

    try { sheet.releasePointerCapture(e.pointerId); } catch (err) {}
    sheet.style.transition    = '';
    backdrop.style.transition = '';

    // Fermeture si :
    //   - geste long : > 15% de la hauteur (ou 80 px min, pour les petits ecrans)
    //   - flick rapide : velocite > 0.5 px/ms ET au moins 25 px
    const distThreshold = Math.min(sheet.offsetHeight * 0.15, 80);
    const FLICK_V       = 0.5;
    const shouldClose   = (delta > distThreshold) || (velocity > FLICK_V && delta > 25);

    if (shouldClose) {
      // Anime jusqu'en bas puis nettoie a la fin de la transition
      sheet.style.transform  = 'translateY(100%)';
      backdrop.style.opacity = '0';
      const cleanup = () => {
        sheet.removeEventListener('transitionend', cleanup);
        container.classList.remove('open');
        container.setAttribute('aria-hidden', 'true');
        sheet.style.transform  = '';
        backdrop.style.opacity = '';
      };
      sheet.addEventListener('transitionend', cleanup, { once: true });
    } else {
      // Snap back a l'etat ouvert
      sheet.style.transform  = '';
      backdrop.style.opacity = '';
    }
  }

  sheet.addEventListener('pointerup',     endDrag);
  sheet.addEventListener('pointercancel', endDrag);
}

// ------- Weight chart SVG -------
// Methode identique a generate_weight_graphs.py : courbe bleue avec marqueurs,
// zone boisson verte (vertical dashed + fill), niveaux pre/post en horizontales.
// Adapte a Supabase qui ne stocke que weight_curve (poids des photos, sans
// pre/post) : pre ≈ premier point, post ≈ dernier point.

const PUMP_OFFSET_G   = 4;                // voir PUMP_OFFSET dans generate_weight_graphs.py
const DRINK_THRESHOLD = 2;                // seuil de consommation minimale

function computeDrinkingZone(curve, drinkingDurationS) {
  if (!Array.isArray(curve) || curve.length < 3) return null;

  // END : 2e point <= post_avg + PUMP_OFFSET (avec post_avg ≈ dernier point)
  const postAvg = curve[curve.length - 1].g;
  const endThreshold = postAvg + PUMP_OFFSET_G;
  let endSec = null;
  let hits = 0;
  for (const p of curve) {
    if (p.g <= endThreshold) {
      hits += 1;
      if (hits >= 2) { endSec = p.t; break; }
    }
  }
  if (endSec === null) endSec = curve[curve.length - 1].t;

  // START : prefere drinking_duration_s (ML) si dispo, sinon premier drop >= DRINK_THRESHOLD
  let startSec;
  if (typeof drinkingDurationS === 'number' && drinkingDurationS > 0) {
    startSec = Math.max(0, endSec - drinkingDurationS);
  } else {
    const w0 = curve[0].g;
    startSec = 0;
    for (const p of curve) {
      if (w0 - p.g >= DRINK_THRESHOLD) { startSec = p.t; break; }
    }
  }

  if (startSec >= endSec) startSec = Math.max(0, endSec - 3);
  return { startSec, endSec };
}

// Ticks arrondis pour l'axe Y
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

function buildWeightChartSvg(s) {
  const curve = Array.isArray(s.weight_curve) ? s.weight_curve : [];
  if (curve.length < 2) {
    return '<div style="text-align:center;color:#9A9285;font-size:12px;padding:40px;">Pas de donnees</div>';
  }

  // Simplification : on ne montre pas la courbe brute mais une courbe
  // stylisee qui respecte le ratio ml/s moyen ET preserve les VRAIS paliers
  // (pauses du chat) detectes dans la donnee. On repere les plateaux via
  // un lissage "running max" (monotone non decroissant), puis on construit
  // la courbe simplifiee avec ces plateaux intercales entre les montees.
  const totalMl = Math.round(s.delta_g || 0);

  // --- 1. Lissage running max ---
  const w0 = curve[0].g;
  let runMax = 0;
  const monoCurve = curve.map(p => {
    const raw = Math.max(0, w0 - p.g);
    runMax = Math.max(runMax, raw);
    return { t: p.t, ml: runMax };
  });

  // --- 2. Detection plateaux (pauses du chat) ---
  //   - seulement entre drinkStart et drinkEnd
  //   - duree minimale : 5s (sinon ce n'est pas une vraie pause)
  //   - exclure niveau 0 (pre-boisson) et niveau final (post-boisson)
  function detectPlateaux(mono, dStart, dEnd, total) {
    const MIN_PAUSE_SEC = 5;
    const out = [];
    let i = 0;
    while (i < mono.length) {
      const p = mono[i];
      if (p.t < dStart) { i++; continue; }
      if (p.t > dEnd)   break;
      const lvl = p.ml;
      if (lvl <= 1 || lvl >= total - 1) { i++; continue; }
      let j = i;
      while (j + 1 < mono.length && mono[j + 1].ml === lvl && mono[j + 1].t <= dEnd) j++;
      const dur = mono[j].t - p.t;
      if (dur >= MIN_PAUSE_SEC) {
        out.push({ tStart: p.t, tEnd: mono[j].t, ml: lvl });
      }
      i = j + 1;
    }
    return out;
  }

  const W = 400, H = 170;
  const padL = 32, padR = 12, padT = 14, padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const tMax = Math.max(...curve.map(p => p.t), 1);
  const ticks = niceTicksMl(Math.max(totalMl, 1) * 1.15, 4);
  const yMax = ticks[ticks.length - 1];

  const xAt = t  => padL + (t / tMax) * innerW;
  const yAt = ml => padT + innerH - (ml / yMax) * innerH;

  // --- Accent chat ---
  const accent = CATS[s.cat]?.accent || '#7BA889';
  const gradId = 'w-grad-' + Math.random().toString(36).slice(2, 8);

  // --- Zone boisson : bornes de la courbe simplifiee ---
  const zone = computeDrinkingZone(curve, s.drinking_duration_s);
  const drinkStart = zone ? zone.startSec : 0;
  const drinkEnd   = zone ? Math.min(zone.endSec, tMax) : tMax;

  let zoneSvg = '';
  if (zone) {
    const xS = xAt(drinkStart);
    const xE = xAt(drinkEnd);
    zoneSvg = `
      <rect x="${xS.toFixed(1)}" y="${padT}" width="${(xE - xS).toFixed(1)}" height="${innerH}"
            fill="#4F7A5D" opacity="0.09"/>
      <line x1="${xS.toFixed(1)}" y1="${padT}" x2="${xS.toFixed(1)}" y2="${(padT + innerH).toFixed(1)}"
            stroke="#4F7A5D" stroke-width="1" stroke-dasharray="3 3" opacity="0.65"
            vector-effect="non-scaling-stroke"/>
      <line x1="${xE.toFixed(1)}" y1="${padT}" x2="${xE.toFixed(1)}" y2="${(padT + innerH).toFixed(1)}"
            stroke="#4F7A5D" stroke-width="1" stroke-dasharray="3 3" opacity="0.65"
            vector-effect="non-scaling-stroke"/>
    `;
  }

  // --- Gridlines horizontaux aux ticks (cream) ---
  const gridLines = ticks.map(t => {
    const y = yAt(t);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${y.toFixed(1)}"
                  stroke="#E8E1D3" stroke-width="0.8" opacity="${t === 0 ? 0.9 : 0.55}"
                  vector-effect="non-scaling-stroke"/>`;
  }).join('');

  // --- Courbe simplifiee : flat a 0 + rises/plateaux detectes + flat a totalMl ---
  const plateaux = detectPlateaux(monoCurve, drinkStart, drinkEnd, totalMl);

  // Construction de la liste de points cles (alternance rises + plateaux)
  const keyPts = [];
  if (drinkStart > 0) keyPts.push({ t: 0, ml: 0 });
  keyPts.push({ t: drinkStart, ml: 0 });
  for (const plat of plateaux) {
    keyPts.push({ t: plat.tStart, ml: plat.ml });    // arrivee sur plateau
    keyPts.push({ t: plat.tEnd,   ml: plat.ml });    // fin plateau
  }
  keyPts.push({ t: drinkEnd, ml: totalMl });
  if (drinkEnd < tMax) keyPts.push({ t: tMax, ml: totalMl });

  const pxPts = keyPts.map(p => ({ x: xAt(p.t), y: yAt(p.ml) }));

  // Path : Bezier cubique entre chaque paire de points consecutifs (rises uniquement)
  // Les plateaux (2 points consecutifs meme y) deviennent des lignes droites horizontales.
  function buildPath(pts) {
    if (pts.length < 2) return '';
    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      // Plateau horizontal : ligne droite
      if (Math.abs(a.y - b.y) < 0.5) {
        d += ` L${b.x.toFixed(1)},${b.y.toFixed(1)}`;
      } else {
        // Rise : Bezier avec tangentes horizontales faibles aux extremites
        const dx = b.x - a.x;
        const tension = 0.2;
        const cp1x = a.x + dx * tension;
        const cp1y = a.y;
        const cp2x = b.x - dx * tension;
        const cp2y = b.y;
        d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
      }
    }
    return d;
  }

  const linePath = buildPath(pxPts);
  const baseY   = padT + innerH;
  const firstX  = pxPts[0].x;
  const lastX   = pxPts[pxPts.length - 1].x;
  const areaPath = `${linePath} L${lastX.toFixed(1)},${baseY.toFixed(1)} L${firstX.toFixed(1)},${baseY.toFixed(1)} Z`;

  const lineSvg = `
    <path d="${areaPath}" fill="url(#${gradId})"/>
    <path d="${linePath}" stroke="${accent}" stroke-width="2.4" fill="none"
          stroke-linecap="round" stroke-linejoin="round"
          vector-effect="non-scaling-stroke"/>
  `;

  // Pas de marqueurs : courbe stylisee, pas de points bruts
  const dots = '';

  // --- Y axis labels (ml) ---
  const yLabels = ticks.map(t => {
    const y = yAt(t);
    return `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#9A9285" font-weight="500">${Math.round(t)}</text>`;
  }).join('');
  const yUnit = `<text x="${padL - 6}" y="${(padT - 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#9A9285" font-weight="600">ml</text>`;

  // --- X axis labels (secondes) ---
  const xLabels = `
    <text x="${padL}" y="${(H - 6).toFixed(1)}" text-anchor="start" font-size="9.5" fill="#9A9285" font-weight="500">0 s</text>
    <text x="${(W - padR).toFixed(1)}" y="${(H - 6).toFixed(1)}" text-anchor="end" font-size="9.5" fill="#9A9285" font-weight="500">${Math.round(tMax)} s</text>
  `;

  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id="${gradId}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stop-color="${accent}" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridLines}
      ${zoneSvg}
      ${lineSvg}
      ${dots}
      ${yUnit}
      ${yLabels}
      ${xLabels}
    </svg>
  `;
}

// ------- Boot -------

async function main() {
  try {
    allSessions = await fetchSessions(14);
    renderFountainPill(allSessions);
    renderTimeline(allSessions);

    // Deep link : ?session=cluster_xxx ouvre directement le bottom sheet
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get('session');
    if (targetId) {
      const found = allSessions.find(s => s.id === targetId);
      if (found) openSheet(found);
    }
  } catch (e) {
    console.error(e);
    document.getElementById('timeline-list').innerHTML =
      `<div class="empty-state">Erreur : ${e.message}</div>`;
  }
}

main();
