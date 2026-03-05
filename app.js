/* =========================================================
   CALENDARIO FACULTAD — app.js
   Logica completa: storage, grilla, CRUD, export/import
   ========================================================= */

'use strict';

// ── CONSTANTES ────────────────────────────────────────────
const STORAGE_KEY = 'calendario_facultad_v1';
const DIAS = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes'];
const DIAS_SHORT = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie'];
const DIAS_ISO = [1, 2, 3, 4, 5]; // getDay(): Lunes=1 ... Viernes=5
const MESES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const TIPO_LABELS = { parcial: 'Parcial', final: 'Final', entrega: 'Entrega', otro: 'Otro' };

const MATERIA_COLORS = [
  '#4F46E5', // indigo
  '#0EA5E9', // sky
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
  '#6366F1', // indigo2
];

// Colores de texto para cada color de materia (blanco o negro segun contraste)
const COLOR_TEXT = {
  '#4F46E5': '#fff', '#0EA5E9': '#fff', '#10B981': '#fff',
  '#F59E0B': '#fff', '#EF4444': '#fff', '#8B5CF6': '#fff',
  '#EC4899': '#fff', '#14B8A6': '#fff', '#F97316': '#fff',
  '#6366F1': '#fff',
};

// Datos iniciales: se cargan desde data.json la primera vez (ver loadState)

// ── ESTADO ────────────────────────────────────────────────
let state = { materias: [], eventos: [] };
let currentWeekOffset = 0;   // 0 = semana actual, +1 = proxima, etc.
let confirmCallback = null;
let activeEventoFilter = 'all';
let highlightedMateriaId = null;

// ── UTILS ─────────────────────────────────────────────────
function uuid() {
  return 'id-' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m) {
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
}

function getMondayOfWeek(offset = 0) {
  const now = new Date();
  const day = now.getDay(); // 0=dom, 1=lun ... 6=sab
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now);
  monday.setDate(diff + offset * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function getWeekDates(offset = 0) {
  const monday = getMondayOfWeek(offset);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function isToday(date) {
  const now = new Date();
  return date.getDate() === now.getDate() &&
         date.getMonth() === now.getMonth() &&
         date.getFullYear() === now.getFullYear();
}

function formatDateShort(dateStr) {
  // dateStr: "YYYY-MM-DD"
  const [, m, d] = dateStr.split('-').map(Number);
  return { dia: d, mes: MESES_SHORT[m - 1] };
}

function isProximo(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const ev = new Date(dateStr + 'T00:00:00');
  const diff = (ev - now) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 7;
}

function isPast(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const ev = new Date(dateStr + 'T00:00:00');
  return ev < now;
}

function daysLabel(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const ev = new Date(dateStr + 'T00:00:00');
  const diff = Math.round((ev - now) / (1000 * 60 * 60 * 24));
  if (diff === 0)  return { text: 'Hoy',        cls: 'days-today' };
  if (diff === 1)  return { text: 'Mañana',      cls: 'days-soon' };
  if (diff === -1) return { text: 'Ayer',        cls: 'days-past' };
  if (diff > 1 && diff <= 7)  return { text: `En ${diff} días`,       cls: 'days-soon' };
  if (diff > 7 && diff <= 30) return { text: `En ${diff} días`,       cls: 'days-future' };
  if (diff > 30)  return { text: `En ${Math.round(diff/7)} semanas`,  cls: 'days-future' };
  if (diff < -1)  return { text: `Hace ${Math.abs(diff)} días`,       cls: 'days-past' };
  return null;
}

// Detecta si dos horarios se superponen
function overlaps(a, b) {
  const aStart = timeToMinutes(a.inicio);
  const aEnd   = timeToMinutes(a.fin);
  const bStart = timeToMinutes(b.inicio);
  const bEnd   = timeToMinutes(b.fin);
  return aStart < bEnd && bStart < aEnd;
}

// ── STORAGE ───────────────────────────────────────────────
const STORAGE_VERSION_KEY = 'calendario_facultad_version';
const GIST_ID_KEY         = 'calendario_gist_id';
const GIST_TOKEN_KEY      = 'calendario_gist_token';
const GIST_FILENAME       = 'data.json';

// ── GIST API ──────────────────────────────────────────────

function getGistConfig() {
  return {
    id:    localStorage.getItem(GIST_ID_KEY)    || '',
    token: localStorage.getItem(GIST_TOKEN_KEY) || '',
  };
}

function isGistConfigured() {
  const { id, token } = getGistConfig();
  return !!(id && token);
}

function setSyncIndicator(status) {
  // status: 'syncing' | 'ok' | 'error' | 'idle'
  const btn = document.getElementById('gist-sync-btn');
  if (!btn) return;
  btn.classList.remove('syncing', 'sync-ok', 'sync-error');
  if (status === 'syncing') btn.classList.add('syncing');
  if (status === 'ok')      btn.classList.add('sync-ok');
  if (status === 'error')   btn.classList.add('sync-error');
}

async function loadFromGist() {
  const { id, token } = getGistConfig();
  const res = await fetch(`https://api.github.com/gists/${id}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`Gist API error: ${res.status}`);
  const data = await res.json();
  const content = data.files?.[GIST_FILENAME]?.content;
  if (!content) throw new Error('Archivo data.json no encontrado en el Gist');
  return JSON.parse(content);
}

async function saveToGist() {
  const { id, token } = getGistConfig();
  if (!id || !token) return; // sin config, no hacer nada

  setSyncIndicator('syncing');
  const today   = new Date().toISOString().slice(0, 10);
  const payload = { version: today, materias: state.materias, eventos: state.eventos };

  try {
    const res = await fetch(`https://api.github.com/gists/${id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: {
          [GIST_FILENAME]: { content: JSON.stringify(payload, null, 2) },
        },
      }),
    });
    if (!res.ok) throw new Error(`Gist PATCH error: ${res.status}`);
    localStorage.setItem(STORAGE_VERSION_KEY, today);
    setSyncIndicator('ok');
    setTimeout(() => setSyncIndicator('idle'), 2500);
  } catch (e) {
    setSyncIndicator('error');
    setTimeout(() => setSyncIndicator('idle'), 3000);
    console.warn('saveToGist failed:', e);
  }
}

async function loadState() {
  if (isGistConfigured()) {
    // ── CON GIST: siempre leer desde Gist como fuente de verdad ──
    try {
      setSyncIndicator('syncing');
      const remote = await loadFromGist();
      state = { materias: remote.materias || [], eventos: remote.eventos || [] };
      // Guardar copia local como caché
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(STORAGE_VERSION_KEY, remote.version || '0000-00-00');
      setSyncIndicator('ok');
      setTimeout(() => setSyncIndicator('idle'), 2500);
    } catch (e) {
      // Sin red o error → usar caché local
      setSyncIndicator('error');
      setTimeout(() => setSyncIndicator('idle'), 3000);
      const raw = localStorage.getItem(STORAGE_KEY);
      state = raw ? JSON.parse(raw) : { materias: [], eventos: [] };
      console.warn('loadFromGist failed, using local cache:', e);
    }
  } else {
    // ── SIN GIST: lógica anterior con data.json ──
    try {
      const res = await fetch('data.json');
      if (!res.ok) throw new Error('fetch failed');
      const remote = await res.json();
      const remoteVersion = remote.version  || '0000-00-00';
      const localVersion  = localStorage.getItem(STORAGE_VERSION_KEY) || '0000-00-00';
      if (remoteVersion > localVersion) {
        state = { materias: remote.materias || [], eventos: remote.eventos || [] };
        saveState(remoteVersion);
      } else {
        const raw = localStorage.getItem(STORAGE_KEY);
        state = raw ? JSON.parse(raw) : { materias: remote.materias || [], eventos: remote.eventos || [] };
      }
    } catch (e) {
      const raw = localStorage.getItem(STORAGE_KEY);
      state = raw ? JSON.parse(raw) : { materias: [], eventos: [] };
    }
  }
}

function saveState(version) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (version) localStorage.setItem(STORAGE_VERSION_KEY, version);
  // Sincronizar al Gist en background (no bloqueante)
  saveToGist();
}

// ── GRILLA SEMANAL ────────────────────────────────────────
const ROW_HEIGHT    = 48; // px por hora
const TOP_PAD       = 8;  // px de espacio antes del primer bloque (evita que el header tape la primera linea)
const BOTTOM_PAD    = 16; // px de espacio debajo del ultimo bloque (evita que el ultimo tick quede cortado)

function renderGrid() {
  const container = document.getElementById('schedule-grid');
  const weekDates = getWeekDates(currentWeekOffset);

  // Actualizar label de semana
  const monday = weekDates[0];
  const friday = weekDates[4];
  const label  = document.getElementById('week-label');
  const fmtDate = d => `${d.getDate()} ${MESES_SHORT[d.getMonth()]}`;
  label.textContent = `${fmtDate(monday)} — ${fmtDate(friday)} ${friday.getFullYear()}`;

  // Recolectar todos los bloques por dia
  const blocksByDay = { Lunes:[], Martes:[], Miercoles:[], Jueves:[], Viernes:[] };
  state.materias.forEach(mat => {
    mat.horarios.forEach(h => {
      if (blocksByDay[h.dia]) {
        blocksByDay[h.dia].push({ materia: mat, horario: h });
      }
    });
  });

  // Si no hay materias, mostrar estado vacio
  const totalBlocks = Object.values(blocksByDay).reduce((s, v) => s + v.length, 0);
  if (totalBlocks === 0) {
    container.innerHTML = `
      <div class="grid-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <h3>Sin materias cargadas</h3>
        <p>Agrega tu primera materia para ver la grilla semanal</p>
      </div>`;
    return;
  }

  // Determinar rango horario global
  let globalMin = Infinity, globalMax = -Infinity;
  Object.values(blocksByDay).forEach(blocks => {
    blocks.forEach(({ horario: h }) => {
      const s = timeToMinutes(h.inicio);
      const e = timeToMinutes(h.fin);
      if (s < globalMin) globalMin = s;
      if (e > globalMax) globalMax = e;
    });
  });
  globalMin = Math.floor(globalMin / 60) * 60;
  globalMax = Math.ceil(globalMax  / 60) * 60;

  // Ticks de hora para la columna lateral
  const hourTicks = [];
  for (let t = globalMin; t <= globalMax; t += 60) hourTicks.push(t);

  // Altura total de la zona de bloques
  const totalMinutes  = globalMax - globalMin;
  const totalHeight   = (totalMinutes / 60) * ROW_HEIGHT + TOP_PAD + BOTTOM_PAD; // px

  // Eventos de la semana actual
  const weekEventsByDay = { Lunes:[], Martes:[], Miercoles:[], Jueves:[], Viernes:[] };
  weekDates.forEach((date, i) => {
    const dateStr = date.toISOString().slice(0, 10);
    state.eventos.forEach(ev => {
      if (ev.fecha === dateStr) weekEventsByDay[DIAS[i]].push(ev);
    });
  });

  // ── Algoritmo de columnas para superposicion ─────────────
  // Devuelve un array de { block, col, totalCols }
  function layoutBlocks(blocks) {
    // Ordenar por hora de inicio
    const sorted = [...blocks].sort((a, b) =>
      timeToMinutes(a.horario.inicio) - timeToMinutes(b.horario.inicio)
    );

    // Agrupar en "clusters" de bloques que se superponen entre si
    const clusters = [];
    sorted.forEach(block => {
      let placed = false;
      for (const cluster of clusters) {
        if (cluster.some(c => overlaps(c.horario, block.horario))) {
          cluster.push(block);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push([block]);
    });

    // Para cada cluster asignar columnas
    const result = [];
    clusters.forEach(cluster => {
      const cols = []; // cols[i] = ultimo fin de esa columna en minutos
      cluster.forEach(block => {
        const bStart = timeToMinutes(block.horario.inicio);
        const bEnd   = timeToMinutes(block.horario.fin);
        // Buscar la primera columna libre
        let assigned = -1;
        for (let i = 0; i < cols.length; i++) {
          if (cols[i] <= bStart) { cols[i] = bEnd; assigned = i; break; }
        }
        if (assigned === -1) { cols.push(bEnd); assigned = cols.length - 1; }
        result.push({ block, col: assigned, _cols: cols });
      });
      // Segunda pasada: fijar totalCols para todos los del cluster
      const totalCols = cols.length;
      result
        .filter(r => cluster.includes(r.block))
        .forEach(r => { r.totalCols = totalCols; });
    });

    return result;
  }

  // ── Construir HTML ────────────────────────────────────────
  let html = '';

  // Cabecera de dias (con badges de eventos de la semana)
  html += '<div class="grid-day-header">';
  html += '<div class="grid-day-header-cell"></div>';
  weekDates.forEach((date, i) => {
    const dia        = DIAS[i];
    const todayClass = isToday(date) ? ' today-col' : '';
    const events     = weekEventsByDay[dia];
    const dayNum     = date.getDate();

    let evBadges = '';
    if (events.length > 0) {
      evBadges = '<div class="day-event-badges">' +
        events.map(ev => {
          const mat       = ev.materiaId ? state.materias.find(m => m.id === ev.materiaId) : null;
          const bgColor   = mat ? mat.color + '28' : '#F59E0B28';
          const textColor = mat ? mat.color : '#92400E';
          const label     = ev.titulo.length > 14 ? ev.titulo.slice(0, 13) + '…' : ev.titulo;
          return `<span class="event-badge" style="background:${bgColor};color:${textColor};" title="${escapeHtml(ev.titulo)}">
            <svg width="6" height="6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>
            ${escapeHtml(label)}
          </span>`;
        }).join('') +
      '</div>';
    }

    html += `<div class="grid-day-header-cell${todayClass}">
      <span class="day-name">${DIAS_SHORT[i]}</span>
      <span class="day-number">${dayNum}</span>
      ${evBadges}
    </div>`;
  });
  html += '</div>';

  // Layout principal: columna de horas + columnas de dias
  html += `<div class="grid-layout" style="height:${totalHeight}px;">`;

  // Columna de horas
  html += '<div class="grid-time-column">';
  hourTicks.forEach(t => {
    const topPx = ((t - globalMin) / 60) * ROW_HEIGHT + TOP_PAD;
    html += `<div class="grid-time-tick" style="top:${topPx}px;">${minutesToTime(t)}</div>`;
  });
  html += '</div>';

  // Columnas de dias
  DIAS.forEach((dia, dIdx) => {
    const todayClass = isToday(weekDates[dIdx]) ? ' today-col' : '';
    const blocks     = blocksByDay[dia];
    const laid       = layoutBlocks(blocks);

    // Lineas horizontales de hora (fondo de la columna)
    let linesHtml = '';
    hourTicks.forEach((t, idx) => {
      if (idx === 0) return; // no dibujar linea en el tope
      const topPx = ((t - globalMin) / 60) * ROW_HEIGHT + TOP_PAD;
      linesHtml += `<div class="grid-hour-line" style="top:${topPx}px;"></div>`;
    });

    // Bloques
    let blocksHtml = '';
    laid.forEach(({ block: { materia, horario }, col, totalCols }) => {
      const horarioIdx = materia.horarios.indexOf(horario);
      const bStart   = timeToMinutes(horario.inicio);
      const bEnd     = timeToMinutes(horario.fin);
      const topPx    = ((bStart - globalMin) / 60) * ROW_HEIGHT + TOP_PAD;
      const heightPx = ((bEnd - bStart)      / 60) * ROW_HEIGHT;
      const bg       = materia.color;
      const fg       = COLOR_TEXT[materia.color] || '#fff';
      const GAP      = 3; // px entre bloques superpuestos
      const widthPct = (100 / totalCols);
      const leftPct  = col * widthPct;
      // Compactar ligeramente para que se vean los separadores
      const wStyle   = `calc(${widthPct}% - ${GAP}px)`;
      const lStyle   = `calc(${leftPct}% + ${col > 0 ? GAP : 0}px)`;

      const smallBlock = heightPx < 48;  // bloque muy chico: solo nombre
      const tinyBlock  = heightPx < 32;  // bloque minusculo: nombre truncado

      blocksHtml += `
        <div class="schedule-block"
          style="top:${topPx}px;height:${heightPx - 2}px;left:${lStyle};width:${wStyle};background:${bg};color:${fg};"
          role="button"
          tabindex="0"
          aria-label="${escapeHtml(materia.nombre)}, ${horario.dia} ${horario.inicio}–${horario.fin}${horario.lugar ? ', ' + horario.lugar : ''}"
          data-materia-id="${materia.id}"
          data-horario-idx="${horarioIdx}"
          data-nombre="${escapeHtml(materia.nombre)}"
          data-dia="${escapeHtml(horario.dia)}"
          data-inicio="${escapeHtml(horario.inicio)}"
          data-fin="${escapeHtml(horario.fin)}"
          data-lugar="${escapeHtml(horario.lugar || '')}"
        >
          <div class="block-nombre${tinyBlock ? ' block-nombre-tiny' : ''}">${escapeHtml(materia.nombre)}</div>
          ${!smallBlock ? `<div class="block-hora">${horario.inicio} – ${horario.fin}</div>` : ''}
          ${!smallBlock && horario.lugar ? `<div class="block-lugar">${escapeHtml(horario.lugar)}</div>` : ''}
        </div>`;
    });

    html += `<div class="grid-day-column${todayClass}" style="height:${totalHeight}px;">
      ${linesHtml}
      ${blocksHtml}
    </div>`;
  });

  html += '</div>'; // grid-layout

  container.innerHTML = html;

  // Eventos de click en bloques
  container.querySelectorAll('.schedule-block').forEach(el => {
    el.addEventListener('click', () => openEditMateria(el.dataset.materiaId));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEditMateria(el.dataset.materiaId);
      }
    });
  });
}

// ── HIGHLIGHT DE MATERIA ──────────────────────────────────
function applyMateriaHighlight() {
  const id = highlightedMateriaId;

  // Grid blocks
  document.querySelectorAll('.schedule-block').forEach(el => {
    if (!id) {
      el.classList.remove('block-highlighted', 'block-dimmed');
    } else if (el.dataset.materiaId === id) {
      el.classList.add('block-highlighted');
      el.classList.remove('block-dimmed');
    } else {
      el.classList.add('block-dimmed');
      el.classList.remove('block-highlighted');
    }
  });

  // Sidebar items
  document.querySelectorAll('.materia-item').forEach(el => {
    if (!id) {
      el.classList.remove('materia-selected', 'materia-dimmed');
    } else if (el.dataset.id === id) {
      el.classList.add('materia-selected');
      el.classList.remove('materia-dimmed');
    } else {
      el.classList.add('materia-dimmed');
      el.classList.remove('materia-selected');
    }
  });
}

// ── SIDEBAR: MATERIAS ─────────────────────────────────────
function renderMateriasList() {
  const list = document.getElementById('materias-list');
  const count = document.getElementById('materias-count');
  count.textContent = state.materias.length;

  if (state.materias.length === 0) {
    list.innerHTML = '<p class="materia-empty">Sin materias. Agrega la primera.</p>';
    return;
  }

  list.innerHTML = state.materias.map(mat => {
    const reg  = mat.regularizacion || {};
    const prom = mat.promocion || {};
    const hasExtra = (mat.links && mat.links.length) ||
                     (mat.profesores && mat.profesores.length) ||
                     reg.asistenciaMin || reg.notaMin || reg.descripcion ||
                     prom.notaMin || prom.descripcion;

    // ── Panel de info ─────────────────────────────────────
    let panelHtml = '';
    if (hasExtra) {
      let rows = '';

      // Links
      if (mat.links && mat.links.length) {
        rows += mat.links.map(l => `
          <div class="ip-row ip-link">
            <svg class="ip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" class="ip-link-anchor">${escapeHtml(l.label || l.url)}</a>
          </div>`).join('');
      }

      // Profesores
      if (mat.profesores && mat.profesores.length) {
        rows += mat.profesores.map(p => `
          <div class="ip-row ip-profesor">
            <svg class="ip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            <span class="ip-profesor-nombre">${escapeHtml(p.nombre)}</span>
            ${p.mail ? `<a href="mailto:${escapeHtml(p.mail)}" class="ip-profesor-mail">${escapeHtml(p.mail)}</a>` : ''}
          </div>`).join('');
      }

      // Regularización
      const regChips = [];
      if (reg.asistenciaMin) regChips.push(`Asist. ≥ ${reg.asistenciaMin}%`);
      if (reg.notaMin)       regChips.push(`Nota ≥ ${reg.notaMin}`);
      if (regChips.length || reg.descripcion) {
        rows += `
          <div class="ip-row ip-cursada">
            <svg class="ip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
            <div class="ip-cursada-body">
              <span class="ip-label">Regularización</span>
              ${regChips.length ? `<div class="ip-chips">${regChips.map(c => `<span class="ip-chip ip-chip-reg">${c}</span>`).join('')}</div>` : ''}
              ${reg.descripcion ? `<span class="ip-desc">${escapeHtml(reg.descripcion)}</span>` : ''}
            </div>
          </div>`;
      }

      // Promoción
      const promChips = [];
      if (prom.notaMin) promChips.push(`Prom. ≥ ${prom.notaMin}`);
      if (promChips.length || prom.descripcion) {
        rows += `
          <div class="ip-row ip-cursada">
            <svg class="ip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <div class="ip-cursada-body">
              <span class="ip-label">Promoción</span>
              ${promChips.length ? `<div class="ip-chips">${promChips.map(c => `<span class="ip-chip ip-chip-prom">${c}</span>`).join('')}</div>` : ''}
              ${prom.descripcion ? `<span class="ip-desc">${escapeHtml(prom.descripcion)}</span>` : ''}
            </div>
          </div>`;
      }

      panelHtml = `<div class="materia-info-panel" id="mip-${mat.id}">${rows}</div>`;
    } else {
      panelHtml = `<div class="materia-info-panel" id="mip-${mat.id}">
        <p class="ip-empty">Sin información adicional.<br>Editá la materia para agregar.</p>
      </div>`;
    }

    return `
      <div class="materia-entry" data-id="${mat.id}">
        <div class="materia-item" data-id="${mat.id}" role="button" tabindex="0" aria-expanded="false" aria-controls="mip-${mat.id}" aria-label="${escapeHtml(mat.nombre)}">
          <div class="materia-dot" style="background:${mat.color}"></div>
          <div class="materia-info">
            <div class="materia-nombre">${escapeHtml(mat.nombre)}</div>
            <div class="materia-horarios-count">${mat.horarios.length} horario${mat.horarios.length !== 1 ? 's' : ''}</div>
          </div>
          <div class="materia-actions">
            <button class="btn-icon" aria-label="Editar ${escapeHtml(mat.nombre)}" data-action="edit-materia" data-id="${mat.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn-icon" aria-label="Eliminar ${escapeHtml(mat.nombre)}" data-action="delete-materia" data-id="${mat.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
                <path d="M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
        </div>
        ${panelHtml}
      </div>`;
  }).join('');

  // ── Event listeners ───────────────────────────────────────
  list.querySelectorAll('.materia-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('[data-action]')) return;
      const entry = el.closest('.materia-entry');
      const panel = entry.querySelector('.materia-info-panel');
      const isOpen = entry.classList.contains('expanded');
      // Cerrar todos los demás
      list.querySelectorAll('.materia-entry.expanded').forEach(other => {
        if (other !== entry) {
          other.classList.remove('expanded');
          other.querySelector('.materia-item').setAttribute('aria-expanded', 'false');
        }
      });
      // Toggle este
      if (isOpen) {
        entry.classList.remove('expanded');
        el.setAttribute('aria-expanded', 'false');
      } else {
        entry.classList.add('expanded');
        el.setAttribute('aria-expanded', 'true');
      }
      // Sin highlight al abrir acordeón
      highlightedMateriaId = null;
      applyMateriaHighlight();
    });
    el.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-action]')) {
        e.preventDefault();
        el.click();
      }
    });
  });

  list.querySelectorAll('[data-action="edit-materia"]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditMateria(btn.dataset.id); });
  });

  list.querySelectorAll('[data-action="delete-materia"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const mat = state.materias.find(m => m.id === btn.dataset.id);
      openConfirm(
        `¿Eliminar la materia "${mat.nombre}"? Tambien se quitara de los eventos asociados.`,
        () => deleteMateria(btn.dataset.id)
      );
    });
  });

  // Links del panel — stopPropagation para no disparar el acordeón
  list.querySelectorAll('.ip-link-anchor, .ip-profesor-mail').forEach(a => {
    a.addEventListener('click', e => e.stopPropagation());
  });
}

// ── SIDEBAR: EVENTOS ──────────────────────────────────────
function renderEventosList() {
  const list  = document.getElementById('eventos-list');
  const count = document.getElementById('eventos-count');
  count.textContent = state.eventos.length;

  let filtered = state.eventos;
  if (activeEventoFilter !== 'all') {
    filtered = filtered.filter(ev => ev.tipo === activeEventoFilter);
  }

  // Ordenar por fecha
  filtered = filtered.slice().sort((a, b) => a.fecha.localeCompare(b.fecha));

  if (filtered.length === 0) {
    list.innerHTML = '<p class="eventos-empty">Sin fechas importantes.</p>';
    return;
  }

  list.innerHTML = filtered.map(ev => {
    const { dia, mes } = formatDateShort(ev.fecha);
    const mat = ev.materiaId ? state.materias.find(m => m.id === ev.materiaId) : null;
    const proximo = isProximo(ev.fecha);
    const past    = isPast(ev.fecha);

    const dl = daysLabel(ev.fecha);
    return `
      <div class="evento-item${proximo ? ' proximo' : ''}" data-id="${ev.id}" style="${past ? 'opacity:0.55' : ''}" role="button" tabindex="0" aria-label="Editar evento ${ev.titulo}">
        <div class="evento-fecha-badge">
          <span class="evento-fecha-dia">${dia}</span>
          <span class="evento-fecha-mes">${mes}</span>
        </div>
        <div class="evento-info">
          <div class="evento-titulo">${escapeHtml(ev.titulo)}</div>
          <div class="evento-meta">
            <span class="evento-tipo-chip chip-${ev.tipo}">${TIPO_LABELS[ev.tipo]}</span>
            ${mat ? `<span class="evento-materia-dot" style="background:${mat.color}"></span>
              <span class="evento-materia-nombre">${escapeHtml(mat.nombre)}</span>` : ''}
            ${dl ? `<span class="days-chip ${dl.cls}">${dl.text}</span>` : ''}
          </div>
        </div>
        <div class="evento-actions">
          <button class="btn-icon" aria-label="Editar evento ${ev.titulo}" data-action="edit-evento" data-id="${ev.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-icon" aria-label="Eliminar evento ${ev.titulo}" data-action="delete-evento" data-id="${ev.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.evento-item').forEach(el => {
    el.addEventListener('click', e => {
      if (!e.target.closest('[data-action]')) openEditEvento(el.dataset.id);
    });
    el.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-action]')) {
        e.preventDefault();
        openEditEvento(el.dataset.id);
      }
    });
  });

  list.querySelectorAll('[data-action="edit-evento"]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditEvento(btn.dataset.id); });
  });

  list.querySelectorAll('[data-action="delete-evento"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const ev = state.eventos.find(v => v.id === btn.dataset.id);
      openConfirm(`¿Eliminar el evento "${ev.titulo}"?`, () => deleteEvento(btn.dataset.id));
    });
  });
}

// ── RENDER COMPLETO ───────────────────────────────────────
function renderAll() {
  renderGrid();
  renderMateriasList();
  renderEventosList();
  applyMateriaHighlight();
}

// ── MODAL HELPERS ─────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  el.removeAttribute('hidden');
  el.querySelector('[data-close]')?.focus();
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).setAttribute('hidden', '');
  document.body.style.overflow = '';
}

function closeAllModals() {
  ['modal-materia', 'modal-evento', 'modal-confirm', 'modal-gist-setup'].forEach(closeModal);
}

// ── COLOR PICKER ──────────────────────────────────────────
function renderColorPicker(selectedColor) {
  const picker = document.getElementById('color-picker');
  picker.innerHTML = MATERIA_COLORS.map((c, i) => `
    <button type="button"
      class="color-swatch${c === selectedColor ? ' selected' : ''}"
      style="background:${c}"
      data-color="${c}"
      role="radio"
      aria-checked="${c === selectedColor}"
      aria-label="Color ${i + 1}"
      tabindex="${c === selectedColor ? '0' : '-1'}"
    ></button>
  `).join('');

  picker.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      picker.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.remove('selected');
        s.setAttribute('aria-checked', 'false');
        s.setAttribute('tabindex', '-1');
      });
      swatch.classList.add('selected');
      swatch.setAttribute('aria-checked', 'true');
      swatch.setAttribute('tabindex', '0');
    });
  });
}

function getSelectedColor() {
  return document.querySelector('.color-swatch.selected')?.dataset.color || MATERIA_COLORS[0];
}

// ── HORARIOS EN MODAL ─────────────────────────────────────
function renderHorarios(horarios = []) {
  const list = document.getElementById('horarios-list');
  if (horarios.length === 0) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = horarios.map((h, i) => buildHorarioRow(h, i)).join('');
  list.querySelectorAll('.btn-remove-horario').forEach(btn => {
    btn.addEventListener('click', () => removeHorarioRow(Number(btn.dataset.index)));
  });
}

function buildHorarioRow(h = {}, i) {
  return `
    <div class="horario-row" data-index="${i}">
      <select aria-label="Dia" class="horario-dia">
        ${DIAS.map(d => `<option value="${d}" ${h.dia === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
      <input type="time" class="horario-inicio" value="${h.inicio || '08:00'}" aria-label="Hora inicio" required />
      <input type="time" class="horario-fin"    value="${h.fin    || '10:00'}" aria-label="Hora fin"    required />
      <input type="text" class="horario-lugar"  value="${h.lugar || ''}" placeholder="Lugar (opcional)" aria-label="Lugar" />
      <button type="button" class="btn-remove-horario" data-index="${i}" aria-label="Eliminar horario">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`;
}

function addHorarioRow() {
  const list = document.getElementById('horarios-list');
  const idx  = list.querySelectorAll('.horario-row').length;
  const div  = document.createElement('div');
  div.innerHTML = buildHorarioRow({}, idx);
  const row = div.firstElementChild;
  list.appendChild(row);
  row.querySelector('.btn-remove-horario').addEventListener('click', () => {
    row.remove();
    // Re-indexar
    list.querySelectorAll('.horario-row').forEach((r, i) => r.dataset.index = i);
  });
}

function removeHorarioRow(idx) {
  const list = document.getElementById('horarios-list');
  const rows = list.querySelectorAll('.horario-row');
  rows[idx]?.remove();
  list.querySelectorAll('.horario-row').forEach((r, i) => r.dataset.index = i);
}

function getHorariosFromModal() {
  const rows = document.querySelectorAll('#horarios-list .horario-row');
  return Array.from(rows).map(row => ({
    dia:    row.querySelector('.horario-dia').value,
    inicio: row.querySelector('.horario-inicio').value,
    fin:    row.querySelector('.horario-fin').value,
    lugar:  row.querySelector('.horario-lugar').value.trim(),
  }));
}

// ── LINKS (modal) ─────────────────────────────────────────
function buildLinkRow(link = {}, i) {
  return `
    <div class="extra-row link-row" data-index="${i}">
      <input type="text"  class="form-input link-label"  value="${escapeHtml(link.label || '')}" placeholder="Etiqueta (ej: Campus virtual)" aria-label="Etiqueta del link" />
      <input type="url"   class="form-input link-url"    value="${escapeHtml(link.url   || '')}" placeholder="https://…" aria-label="URL" />
      <button type="button" class="btn-remove-row" aria-label="Eliminar link">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`;
}

function renderLinks(links) {
  const list = document.getElementById('links-list');
  list.innerHTML = '';
  (links || []).forEach((l, i) => {
    const div = document.createElement('div');
    div.innerHTML = buildLinkRow(l, i);
    const row = div.firstElementChild;
    list.appendChild(row);
    row.querySelector('.btn-remove-row').addEventListener('click', () => {
      row.remove();
      list.querySelectorAll('.link-row').forEach((r, j) => r.dataset.index = j);
    });
  });
}

function addLinkRow() {
  const list = document.getElementById('links-list');
  const idx  = list.querySelectorAll('.link-row').length;
  const div  = document.createElement('div');
  div.innerHTML = buildLinkRow({}, idx);
  const row = div.firstElementChild;
  list.appendChild(row);
  row.querySelector('.btn-remove-row').addEventListener('click', () => {
    row.remove();
    list.querySelectorAll('.link-row').forEach((r, j) => r.dataset.index = j);
  });
  row.querySelector('.link-label').focus();
}

function getLinksFromModal() {
  return Array.from(document.querySelectorAll('#links-list .link-row'))
    .map(row => ({
      label: row.querySelector('.link-label').value.trim(),
      url:   row.querySelector('.link-url').value.trim(),
    }))
    .filter(l => l.url); // descartar filas vacías
}

// ── PROFESORES (modal) ────────────────────────────────────
function buildProfesorRow(prof = {}, i) {
  return `
    <div class="extra-row profesor-row" data-index="${i}">
      <input type="text"  class="form-input profesor-nombre" value="${escapeHtml(prof.nombre || '')}" placeholder="Nombre" aria-label="Nombre del profesor" />
      <input type="email" class="form-input profesor-mail"   value="${escapeHtml(prof.mail   || '')}" placeholder="Mail (opcional)" aria-label="Mail del profesor" />
      <button type="button" class="btn-remove-row" aria-label="Eliminar profesor">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`;
}

function renderProfesores(profesores) {
  const list = document.getElementById('profesores-list');
  list.innerHTML = '';
  (profesores || []).forEach((p, i) => {
    const div = document.createElement('div');
    div.innerHTML = buildProfesorRow(p, i);
    const row = div.firstElementChild;
    list.appendChild(row);
    row.querySelector('.btn-remove-row').addEventListener('click', () => {
      row.remove();
      list.querySelectorAll('.profesor-row').forEach((r, j) => r.dataset.index = j);
    });
  });
}

function addProfesorRow() {
  const list = document.getElementById('profesores-list');
  const idx  = list.querySelectorAll('.profesor-row').length;
  const div  = document.createElement('div');
  div.innerHTML = buildProfesorRow({}, idx);
  const row = div.firstElementChild;
  list.appendChild(row);
  row.querySelector('.btn-remove-row').addEventListener('click', () => {
    row.remove();
    list.querySelectorAll('.profesor-row').forEach((r, j) => r.dataset.index = j);
  });
  row.querySelector('.profesor-nombre').focus();
}

function getProfesoresFromModal() {
  return Array.from(document.querySelectorAll('#profesores-list .profesor-row'))
    .map(row => ({
      nombre: row.querySelector('.profesor-nombre').value.trim(),
      mail:   row.querySelector('.profesor-mail').value.trim(),
    }))
    .filter(p => p.nombre); // descartar filas sin nombre
}

// ── MODAL MATERIA ─────────────────────────────────────────
function openNewMateria() {
  document.getElementById('materia-id').value    = '';
  document.getElementById('materia-nombre').value = '';
  document.getElementById('modal-materia-title').textContent = 'Nueva materia';
  // Siguiente color disponible
  const usedColors = state.materias.map(m => m.color);
  const nextColor  = MATERIA_COLORS.find(c => !usedColors.includes(c)) || MATERIA_COLORS[0];
  renderColorPicker(nextColor);
  renderHorarios([{ dia: 'Lunes', inicio: '08:00', fin: '10:00', lugar: '' }]);
  // Limpiar campos extra
  renderLinks([]);
  renderProfesores([]);
  document.getElementById('reg-asistencia').value = '';
  document.getElementById('reg-nota').value        = '';
  document.getElementById('reg-desc').value        = '';
  document.getElementById('prom-nota').value       = '';
  document.getElementById('prom-desc').value       = '';
  document.getElementById('materia-extra').removeAttribute('open');
  openModal('modal-materia');
  document.getElementById('materia-nombre').focus();
}

function openEditMateria(id) {
  const mat = state.materias.find(m => m.id === id);
  if (!mat) return;
  document.getElementById('materia-id').value     = mat.id;
  document.getElementById('materia-nombre').value = mat.nombre;
  document.getElementById('modal-materia-title').textContent = 'Editar materia';
  renderColorPicker(mat.color);
  renderHorarios(mat.horarios);
  // Poblar campos extra
  renderLinks(mat.links || []);
  renderProfesores(mat.profesores || []);
  const reg = mat.regularizacion || {};
  document.getElementById('reg-asistencia').value = reg.asistenciaMin || '';
  document.getElementById('reg-nota').value        = reg.notaMin       || '';
  document.getElementById('reg-desc').value        = reg.descripcion   || '';
  const prom = mat.promocion || {};
  document.getElementById('prom-nota').value       = prom.notaMin      || '';
  document.getElementById('prom-desc').value       = prom.descripcion  || '';
  // Abrir <details> si hay datos extra
  const hasExtra = (mat.links && mat.links.length) ||
                   (mat.profesores && mat.profesores.length) ||
                   reg.asistenciaMin || reg.notaMin || reg.descripcion ||
                   prom.notaMin || prom.descripcion;
  if (hasExtra) {
    document.getElementById('materia-extra').setAttribute('open', '');
  } else {
    document.getElementById('materia-extra').removeAttribute('open');
  }
  openModal('modal-materia');
  document.getElementById('materia-nombre').focus();
}

function saveMateria() {
  const id     = document.getElementById('materia-id').value;
  const nombre = document.getElementById('materia-nombre').value.trim();
  if (!nombre) {
    showToast('Ingresa el nombre de la materia', 'error');
    document.getElementById('materia-nombre').focus();
    return;
  }

  const horarios = getHorariosFromModal();
  // Validar que inicio < fin
  for (const h of horarios) {
    if (timeToMinutes(h.inicio) >= timeToMinutes(h.fin)) {
      showToast(`El horario del ${h.dia} tiene hora de inicio mayor o igual a la de fin`, 'error');
      return;
    }
  }

  const color = getSelectedColor();

  // Leer campos extra
  const links      = getLinksFromModal();
  const profesores = getProfesoresFromModal();
  const regularizacion = {
    asistenciaMin: document.getElementById('reg-asistencia').value.trim(),
    notaMin:       document.getElementById('reg-nota').value.trim(),
    descripcion:   document.getElementById('reg-desc').value.trim(),
  };
  const promocion = {
    notaMin:     document.getElementById('prom-nota').value.trim(),
    descripcion: document.getElementById('prom-desc').value.trim(),
  };

  const matData = { id: id || uuid(), nombre, color, horarios, links, profesores, regularizacion, promocion };

  if (id) {
    const idx = state.materias.findIndex(m => m.id === id);
    state.materias[idx] = matData;
    showToast(`Materia "${nombre}" actualizada`, 'success');
  } else {
    state.materias.push(matData);
    showToast(`Materia "${nombre}" agregada`, 'success');
  }

  saveState();
  closeModal('modal-materia');
  renderAll();
}

function deleteMateria(id) {
  const mat = state.materias.find(m => m.id === id);
  state.materias = state.materias.filter(m => m.id !== id);
  // Limpiar referencia en eventos
  state.eventos = state.eventos.map(ev => ({
    ...ev, materiaId: ev.materiaId === id ? '' : ev.materiaId
  }));
  saveState();
  closeModal('modal-confirm');
  renderAll();
  showToast(`Materia "${mat.nombre}" eliminada`, 'info');
}

// ── MODAL EVENTO ──────────────────────────────────────────
function populateMateriaSelect(selectedId = '') {
  const sel = document.getElementById('evento-materia');
  sel.innerHTML = '<option value="">— Sin materia —</option>' +
    state.materias.map(m =>
      `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${escapeHtml(m.nombre)}</option>`
    ).join('');
}

function openNewEvento() {
  document.getElementById('evento-id').value      = '';
  document.getElementById('evento-titulo').value   = '';
  document.getElementById('evento-fecha').value    = new Date().toISOString().slice(0, 10);
  document.getElementById('evento-tipo').value     = 'parcial';
  document.getElementById('evento-notas').value    = '';
  document.getElementById('modal-evento-title').textContent = 'Nuevo evento';
  populateMateriaSelect();
  openModal('modal-evento');
  document.getElementById('evento-titulo').focus();
}

function openEditEvento(id) {
  const ev = state.eventos.find(e => e.id === id);
  if (!ev) return;
  document.getElementById('evento-id').value      = ev.id;
  document.getElementById('evento-titulo').value   = ev.titulo;
  document.getElementById('evento-fecha').value    = ev.fecha;
  document.getElementById('evento-tipo').value     = ev.tipo;
  document.getElementById('evento-notas').value    = ev.notas || '';
  document.getElementById('modal-evento-title').textContent = 'Editar evento';
  populateMateriaSelect(ev.materiaId || '');
  openModal('modal-evento');
  document.getElementById('evento-titulo').focus();
}

function saveEvento() {
  const id     = document.getElementById('evento-id').value;
  const titulo = document.getElementById('evento-titulo').value.trim();
  const fecha  = document.getElementById('evento-fecha').value;
  const tipo   = document.getElementById('evento-tipo').value;
  const notas  = document.getElementById('evento-notas').value.trim();
  const materiaId = document.getElementById('evento-materia').value;

  if (!titulo) {
    showToast('Ingresa el titulo del evento', 'error');
    document.getElementById('evento-titulo').focus();
    return;
  }
  if (!fecha) {
    showToast('Selecciona una fecha', 'error');
    document.getElementById('evento-fecha').focus();
    return;
  }

  if (id) {
    const idx = state.eventos.findIndex(e => e.id === id);
    state.eventos[idx] = { id, titulo, fecha, tipo, notas, materiaId };
    showToast(`Evento "${titulo}" actualizado`, 'success');
  } else {
    state.eventos.push({ id: uuid(), titulo, fecha, tipo, notas, materiaId });
    showToast(`Evento "${titulo}" agregado`, 'success');
  }

  saveState();
  closeModal('modal-evento');
  renderAll();
}

function deleteEvento(id) {
  const ev = state.eventos.find(e => e.id === id);
  state.eventos = state.eventos.filter(e => e.id !== id);
  saveState();
  closeModal('modal-confirm');
  renderAll();
  showToast(`Evento "${ev.titulo}" eliminado`, 'info');
}

// ── CONFIRM MODAL ─────────────────────────────────────────
function openConfirm(text, onConfirm) {
  document.getElementById('confirm-text').textContent = text;
  confirmCallback = onConfirm;
  openModal('modal-confirm');
}

// ── EXPORT / IMPORT ───────────────────────────────────────
function exportData() {
  const today   = new Date().toISOString().slice(0, 10);
  const payload = { version: today, materias: state.materias, eventos: state.eventos };
  const json    = JSON.stringify(payload, null, 2);
  const blob    = new Blob([json], { type: 'application/json' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href        = url;
  a.download    = 'data.json';
  a.click();
  URL.revokeObjectURL(url);
  // Actualizar version local para que no se sobreescriba al recargar
  localStorage.setItem(STORAGE_VERSION_KEY, today);
  showToast('Exportado como data.json — reemplazá el archivo en el repo y hacé push', 'success');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported.materias || !imported.eventos) throw new Error('Formato invalido');
      const version = imported.version || new Date().toISOString().slice(0, 10);
      state = { materias: imported.materias, eventos: imported.eventos };
      saveState(version);
      renderAll();
      showToast('Datos importados correctamente', 'success');
    } catch {
      showToast('El archivo no tiene un formato valido', 'error');
    }
  };
  reader.readAsText(file);
}

// ── TOAST ──────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `${icons[type] || icons.info}<span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3200);
}

// ── ESCAPE HTML ───────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── GIST SETUP MODAL ──────────────────────────────────────

function openGistSetup() {
  const { id, token } = getGistConfig();
  document.getElementById('gist-id-input').value    = id;
  document.getElementById('gist-token-input').value = token;
  const errEl = document.getElementById('gist-setup-error');
  errEl.textContent = '';
  errEl.hidden = true;
  openModal('modal-gist-setup');
  document.getElementById('gist-id-input').focus();
}

async function connectGist() {
  const id    = document.getElementById('gist-id-input').value.trim();
  const token = document.getElementById('gist-token-input').value.trim();
  const errEl = document.getElementById('gist-setup-error');
  const btn   = document.getElementById('btn-gist-connect');

  errEl.hidden = true;

  if (!id || !token) {
    errEl.textContent = 'Ingresa el Gist ID y el token.';
    errEl.hidden = false;
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Conectando...';

  try {
    // Validar que el Gist existe y el token funciona
    const res = await fetch(`https://api.github.com/gists/${id}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (res.status === 401) throw new Error('Token invalido o sin permisos. Verificá que tenga el scope "gist".');
    if (res.status === 404) throw new Error('Gist no encontrado. Verificá el ID.');
    if (!res.ok) throw new Error(`Error de API: ${res.status}`);

    const data = await res.json();
    if (!data.files?.[GIST_FILENAME]) {
      throw new Error(`El Gist no contiene un archivo llamado "${GIST_FILENAME}". Crealo con ese nombre exacto.`);
    }

    // Guardar config
    localStorage.setItem(GIST_ID_KEY,    id);
    localStorage.setItem(GIST_TOKEN_KEY, token);

    closeModal('modal-gist-setup');
    showGistSyncBtn();

    // Cargar datos del Gist
    const content = data.files[GIST_FILENAME].content;
    const remote  = JSON.parse(content);
    state = { materias: remote.materias || [], eventos: remote.eventos || [] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(STORAGE_VERSION_KEY, remote.version || '0000-00-00');
    renderAll();
    showToast('Sincronizacion configurada correctamente', 'success');

  } catch (e) {
    errEl.textContent = e.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:15px;height:15px;"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Conectar`;
  }
}

function showGistSyncBtn() {
  const btn = document.getElementById('gist-sync-btn');
  if (btn) btn.hidden = false;
}

// ── EXPORT PNG ────────────────────────────────────────────
async function exportPNG() {
  const target = document.getElementById('calendar-section');
  if (!target) { showToast('No se encontro la grilla', 'error'); return; }

  showToast('Generando imagen…', 'info');

  // Lazy-load dom-to-image-more from CDN
  if (!window.domtoimage) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/dom-to-image-more@3.7.2/dist/dom-to-image-more.min.js';
      script.onload  = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  try {
    const scale = window.devicePixelRatio || 2;
    const dataUrl = await window.domtoimage.toPng(target, {
      width:  target.offsetWidth  * scale,
      height: target.offsetHeight * scale,
      style: {
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      },
    });
    const a = document.createElement('a');
    a.href     = dataUrl;
    a.download = 'calendario.png';
    a.click();
    showToast('Imagen guardada como calendario.png', 'success');
  } catch (e) {
    console.error('exportPNG error:', e);
    showToast('No se pudo generar la imagen', 'error');
  }
}

// ── PRINT / PDF ───────────────────────────────────────────
function printGrid() {
  window.print();
}

// ── HAMBURGER MENU ────────────────────────────────────────
function toggleHamburgerMenu() {
  const btn  = document.getElementById('btn-hamburger');
  const menu = document.getElementById('header-menu');
  const isOpen = btn.getAttribute('aria-expanded') === 'true';

  if (isOpen) {
    closeHamburgerMenu();
  } else {
    btn.setAttribute('aria-expanded', 'true');
    menu.removeAttribute('hidden');
    // Focus primer item
    menu.querySelector('.header-menu-item')?.focus();
  }
}

function closeHamburgerMenu() {
  const btn  = document.getElementById('btn-hamburger');
  const menu = document.getElementById('header-menu');
  btn.setAttribute('aria-expanded', 'false');
  menu.setAttribute('hidden', '');
}

// ── DRAG TO MOVE HORARIOS ─────────────────────────────────
(function setupDragBlocks() {
  let drag = null; // active drag state
  let ghost = null;

  function getGridInfo() {
    const layout = document.querySelector('.grid-layout');
    if (!layout) return null;
    const dayColumns = Array.from(layout.querySelectorAll('.grid-day-column'));
    if (dayColumns.length === 0) return null;
    const layoutRect = layout.getBoundingClientRect();
    return { layout, dayColumns, layoutRect };
  }

  // Convert clientY → minutes-from-globalMin, snapped to 15 min
  function yToMinutes(clientY, layoutRect, globalMin) {
    const relY = clientY - layoutRect.top - TOP_PAD;
    const raw  = (relY / ROW_HEIGHT) * 60 + globalMin;
    return Math.round(raw / 15) * 15;
  }

  // Find which day column index the clientX falls into (-1 = none)
  function xToDayIdx(clientX, dayColumns) {
    for (let i = 0; i < dayColumns.length; i++) {
      const r = dayColumns[i].getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return i;
    }
    return -1;
  }

  function createGhost(sourceEl) {
    const g = sourceEl.cloneNode(true);
    const r = sourceEl.getBoundingClientRect();
    g.style.position   = 'fixed';
    g.style.width      = r.width + 'px';
    g.style.height     = r.height + 'px';
    g.style.top        = r.top  + 'px';
    g.style.left       = r.left + 'px';
    g.style.zIndex     = '500';
    g.style.opacity    = '0.75';
    g.style.pointerEvents = 'none';
    g.style.transition = 'none';
    g.style.cursor     = 'grabbing';
    g.removeAttribute('data-materia-id');
    g.id = 'drag-ghost';
    document.body.appendChild(g);
    return g;
  }

  function showDropIndicator(dayColumns, dayIdx, topPx, heightPx) {
    removeDropIndicator();
    if (dayIdx < 0 || dayIdx >= dayColumns.length) return;
    const col = dayColumns[dayIdx];
    const ind = document.createElement('div');
    ind.id = 'drag-drop-indicator';
    ind.style.cssText = `
      position:absolute;top:${topPx}px;left:2px;right:2px;height:${heightPx - 2}px;
      background:rgba(99,102,241,0.18);border:2px dashed #6366F1;
      border-radius:6px;pointer-events:none;z-index:20;
    `;
    col.appendChild(ind);
  }

  function removeDropIndicator() {
    const old = document.getElementById('drag-drop-indicator');
    if (old) old.remove();
  }

  document.addEventListener('mousedown', e => {
    const block = e.target.closest('.schedule-block');
    if (!block) return;
    if (e.button !== 0) return;

    const materiaId  = block.dataset.materiaId;
    const horarioIdx = parseInt(block.dataset.horarioIdx, 10);
    const mat = state.materias.find(m => m.id === materiaId);
    if (!mat || isNaN(horarioIdx)) return;
    const horario = mat.horarios[horarioIdx];
    if (!horario) return;

    const blockRect = block.getBoundingClientRect();
    drag = {
      block,
      mat,
      horario,
      horarioIdx,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - blockRect.left,
      offsetY: e.clientY - blockRect.top,
      durMin: timeToMinutes(horario.fin) - timeToMinutes(horario.inicio),
      moved: false,
    };
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!drag) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.moved && Math.sqrt(dx * dx + dy * dy) < 8) return;

    if (!drag.moved) {
      // Start drag visuals
      drag.moved = true;
      drag.block.style.opacity = '0.3';
      ghost = createGhost(drag.block);
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    }

    // Move ghost
    ghost.style.top  = (e.clientY - drag.offsetY) + 'px';
    ghost.style.left = (e.clientX - drag.offsetX) + 'px';

    // Compute snap target
    const gInfo = getGridInfo();
    if (!gInfo) return;
    // Read globalMin from the layout data (stored in first day column's blocks or computed fresh)
    const globalMin = computeGlobalMin();
    const snappedStart = yToMinutes(e.clientY - drag.offsetY, gInfo.layoutRect, globalMin);
    const snappedEnd   = snappedStart + drag.durMin;
    const dayIdx       = xToDayIdx(e.clientX, gInfo.dayColumns);

    const topPx    = ((snappedStart - globalMin) / 60) * ROW_HEIGHT + TOP_PAD;
    const heightPx = (drag.durMin / 60) * ROW_HEIGHT;

    showDropIndicator(gInfo.dayColumns, dayIdx, topPx, heightPx);
    drag._snapDayIdx = dayIdx;
    drag._snapStart  = snappedStart;
    drag._snapEnd    = snappedEnd;
  });

  document.addEventListener('mouseup', e => {
    if (!drag) return;

    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    removeDropIndicator();

    if (ghost) { ghost.remove(); ghost = null; }
    drag.block.style.opacity = '';

    if (drag.moved && drag._snapDayIdx >= 0 && drag._snapDayIdx < DIAS.length) {
      const newDia    = DIAS[drag._snapDayIdx];
      const newInicio = minutesToTime(drag._snapStart);
      const newFin    = minutesToTime(drag._snapEnd);

      // Guard: keep within 0–24h and at least 15 min
      if (drag._snapStart >= 0 && drag._snapEnd <= 24 * 60 && drag._snapEnd > drag._snapStart) {
        drag.horario.dia    = newDia;
        drag.horario.inicio = newInicio;
        drag.horario.fin    = newFin;
        saveState();
        renderAll();
        showToast(`Horario movido a ${newDia} ${newInicio}–${newFin}`, 'success');
      }
    }

    drag = null;
  });

  // Cancel on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drag) {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      removeDropIndicator();
      if (ghost) { ghost.remove(); ghost = null; }
      drag.block.style.opacity = '';
      drag = null;
    }
  });
})();

function computeGlobalMin() {
  let globalMin = Infinity;
  state.materias.forEach(mat => {
    mat.horarios.forEach(h => {
      const s = timeToMinutes(h.inicio);
      if (s < globalMin) globalMin = s;
    });
  });
  if (!isFinite(globalMin)) globalMin = 8 * 60;
  return Math.floor(globalMin / 60) * 60;
}

// ── SWIPE NAVIGATION (mobile) ─────────────────────────────
function setupSwipeNavigation() {
  const wrapper = document.querySelector('.grid-wrapper');
  if (!wrapper) return;

  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartScrollLeft = 0;

  wrapper.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartScrollLeft = wrapper.scrollLeft;
  }, { passive: true });

  wrapper.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;

    // Only trigger if horizontal swipe dominates and is large enough
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // Only trigger if the wrapper didn't actually scroll horizontally
    const scrolled = Math.abs(wrapper.scrollLeft - touchStartScrollLeft);
    if (scrolled > 20) return;

    if (dx < 0) {
      currentWeekOffset++;
    } else {
      currentWeekOffset--;
    }
    renderGrid();
    applyMateriaHighlight();
  }, { passive: true });
}

// ── BLOCK TOOLTIP ─────────────────────────────────────────
function setupBlockTooltip() {
  const tooltip = document.getElementById('block-tooltip');
  if (!tooltip) return;

  let hideTimer = null;

  function showTooltip(block, x, y) {
    clearTimeout(hideTimer);
    const nombre = block.dataset.nombre || '';
    const dia    = block.dataset.dia    || '';
    const inicio = block.dataset.inicio || '';
    const fin    = block.dataset.fin    || '';
    const lugar  = block.dataset.lugar  || '';

    tooltip.innerHTML =
      `<div class="tt-nombre">${escapeHtml(nombre)}</div>` +
      `<div class="tt-row">${escapeHtml(dia)} &nbsp;·&nbsp; ${escapeHtml(inicio)} – ${escapeHtml(fin)}</div>` +
      (lugar ? `<div class="tt-row tt-lugar">${escapeHtml(lugar)}</div>` : '');

    tooltip.style.display = 'block';
    tooltip.setAttribute('aria-hidden', 'false');
    positionTooltip(x, y);
  }

  function positionTooltip(x, y) {
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x + 12;
    let top  = y + 12;
    if (left + tw > vw - 8) left = x - tw - 12;
    if (top  + th > vh - 8) top  = y - th - 12;
    tooltip.style.left = left + 'px';
    tooltip.style.top  = top  + 'px';
  }

  function hideTooltip() {
    hideTimer = setTimeout(() => {
      tooltip.style.display = 'none';
      tooltip.setAttribute('aria-hidden', 'true');
    }, 80);
  }

  document.addEventListener('mouseover', e => {
    const block = e.target.closest('.schedule-block');
    if (block) showTooltip(block, e.clientX, e.clientY);
  });

  document.addEventListener('mousemove', e => {
    if (tooltip.style.display === 'block') {
      const block = e.target.closest('.schedule-block');
      if (block) positionTooltip(e.clientX, e.clientY);
    }
  });

  document.addEventListener('mouseout', e => {
    const block = e.target.closest('.schedule-block');
    if (block && !block.contains(e.relatedTarget)) hideTooltip();
  });

  // Hide on scroll or click
  document.addEventListener('scroll', hideTooltip, true);
  document.addEventListener('click',  hideTooltip, true);
}

// ── INIT: EVENT LISTENERS ─────────────────────────────────
async function init() {
  await loadState();

  // Mostrar botón de sync si ya está configurado, si no → abrir setup
  if (isGistConfigured()) {
    showGistSyncBtn();
  } else {
    openGistSetup();
  }

  // Gist sync button: click abre el modal de reconfigurar
  document.getElementById('gist-sync-btn').addEventListener('click', openGistSetup);

  // Gist setup modal buttons
  document.getElementById('btn-gist-connect').addEventListener('click', connectGist);
  document.getElementById('btn-gist-skip').addEventListener('click', () => closeModal('modal-gist-setup'));
  document.getElementById('modal-gist-setup').addEventListener('click', e => {
    if (e.target.id === 'modal-gist-setup') closeModal('modal-gist-setup');
  });

  // Header actions (desktop)
  document.getElementById('btn-new-materia').addEventListener('click', openNewMateria);
  document.getElementById('btn-new-evento').addEventListener('click', openNewEvento);
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-export-png').addEventListener('click', exportPNG);
  document.getElementById('btn-print').addEventListener('click', printGrid);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', e => {
    if (e.target.files[0]) {
      importData(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Hamburger toggle
  document.getElementById('btn-hamburger').addEventListener('click', toggleHamburgerMenu);

  // Menu items (mobile dropdown)
  document.getElementById('header-menu').addEventListener('click', e => {
    const item = e.target.closest('[data-menu-action]');
    if (!item) return;
    closeHamburgerMenu();
    const action = item.dataset.menuAction;
    if      (action === 'new-materia') openNewMateria();
    else if (action === 'new-evento')  openNewEvento();
    else if (action === 'export-png')  exportPNG();
    else if (action === 'print')       printGrid();
    else if (action === 'import')      document.getElementById('import-file-input').click();
    else if (action === 'export')      exportData();
  });

  // Close hamburger menu on outside click
  document.addEventListener('click', e => {
    const menu = document.getElementById('header-menu');
    const btn  = document.getElementById('btn-hamburger');
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) {
      closeHamburgerMenu();
    }
    // Deselect materia highlight when clicking outside sidebar or grid blocks
    if (highlightedMateriaId &&
        !e.target.closest('.materia-item') &&
        !e.target.closest('.schedule-block')) {
      highlightedMateriaId = null;
      applyMateriaHighlight();
    }
  });

  // Week navigation
  document.getElementById('btn-prev-week').addEventListener('click', () => {
    currentWeekOffset--;
    renderGrid();
    applyMateriaHighlight();
  });
  document.getElementById('btn-next-week').addEventListener('click', () => {
    currentWeekOffset++;
    renderGrid();
    applyMateriaHighlight();
  });
  document.getElementById('btn-today').addEventListener('click', () => {
    currentWeekOffset = 0;
    renderGrid();
    applyMateriaHighlight();
  });

  // Save buttons
  document.getElementById('btn-save-materia').addEventListener('click', saveMateria);
  document.getElementById('btn-save-evento').addEventListener('click', saveEvento);
  document.getElementById('btn-confirm-delete').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
  });

  // Add horario / link / profesor
  document.getElementById('btn-add-horario').addEventListener('click', addHorarioRow);
  document.getElementById('btn-add-link').addEventListener('click', addLinkRow);
  document.getElementById('btn-add-profesor').addEventListener('click', addProfesorRow);

  // Close modals
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Close on overlay click
  ['modal-materia', 'modal-evento', 'modal-confirm'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target.id === id) closeModal(id);
    });
  });

  // Escape key closes modals and hamburger menu
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeAllModals();
      closeHamburgerMenu();
    }

    // Atajos de teclado — ignorar si el foco está en un campo de texto
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Ignorar si hay un modal abierto (excepto Escape, ya manejado)
    if (document.querySelector('.modal-overlay[style*="flex"]')) return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      currentWeekOffset--;
      renderGrid();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      currentWeekOffset++;
      renderGrid();
    } else if (e.key === 't' || e.key === 'T') {
      currentWeekOffset = 0;
      renderGrid();
    } else if (e.key === 'n' || e.key === 'N') {
      openNewMateria();
    } else if (e.key === 'e' || e.key === 'E') {
      openNewEvento();
    }
  });

  // Eventos filter
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeEventoFilter = btn.dataset.filter;
      renderEventosList();
    });
  });

  // Render inicial
  renderAll();

  // Tooltip sobre bloques del grid (delegación global)
  setupBlockTooltip();

  // Swipe horizontal para navegar semanas (mobile)
  setupSwipeNavigation();
}

// Arrancar cuando el DOM este listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init());
} else {
  init();
}
