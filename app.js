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

// Detecta si dos horarios se superponen
function overlaps(a, b) {
  const aStart = timeToMinutes(a.inicio);
  const aEnd   = timeToMinutes(a.fin);
  const bStart = timeToMinutes(b.inicio);
  const bEnd   = timeToMinutes(b.fin);
  return aStart < bEnd && bStart < aEnd;
}

// ── STORAGE ───────────────────────────────────────────────
async function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = JSON.parse(raw);
      return;
    }
    // Sin localStorage: cargar desde data.json
    const res = await fetch('data.json');
    if (!res.ok) throw new Error('No se pudo cargar data.json');
    const data = await res.json();
    state = { materias: data.materias || [], eventos: data.eventos || [] };
    saveState();
  } catch (e) {
    // Fallback seguro: estado vacio
    state = { materias: [], eventos: [] };
    saveState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

// ── SIDEBAR: MATERIAS ─────────────────────────────────────
function renderMateriasList() {
  const list = document.getElementById('materias-list');
  const count = document.getElementById('materias-count');
  count.textContent = state.materias.length;

  if (state.materias.length === 0) {
    list.innerHTML = '<p class="materia-empty">Sin materias. Agrega la primera.</p>';
    return;
  }

  list.innerHTML = state.materias.map(mat => `
    <div class="materia-item" data-id="${mat.id}" role="button" tabindex="0" aria-label="Editar ${mat.nombre}">
      <div class="materia-dot" style="background:${mat.color}"></div>
      <div class="materia-info">
        <div class="materia-nombre">${escapeHtml(mat.nombre)}</div>
        <div class="materia-horarios-count">${mat.horarios.length} horario${mat.horarios.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="materia-actions">
        <button class="btn-icon" aria-label="Editar ${mat.nombre}" data-action="edit-materia" data-id="${mat.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn-icon" aria-label="Eliminar ${mat.nombre}" data-action="delete-materia" data-id="${mat.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.materia-item').forEach(el => {
    el.addEventListener('click', e => {
      if (!e.target.closest('[data-action]')) openEditMateria(el.dataset.id);
    });
    el.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-action]')) {
        e.preventDefault();
        openEditMateria(el.dataset.id);
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
            ${proximo ? '<span class="proximo-indicator">Proximo</span>' : ''}
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
  ['modal-materia', 'modal-evento', 'modal-confirm'].forEach(closeModal);
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

  if (id) {
    // Editar
    const idx = state.materias.findIndex(m => m.id === id);
    state.materias[idx] = { id, nombre, color, horarios };
    showToast(`Materia "${nombre}" actualizada`, 'success');
  } else {
    // Nueva
    state.materias.push({ id: uuid(), nombre, color, horarios });
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
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `calendario_facultad_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Datos exportados correctamente', 'success');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported.materias || !imported.eventos) throw new Error('Formato invalido');
      state = imported;
      saveState();
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

// ── INIT: EVENT LISTENERS ─────────────────────────────────
async function init() {
  await loadState();

  // Header actions
  document.getElementById('btn-new-materia').addEventListener('click', openNewMateria);
  document.getElementById('btn-new-evento').addEventListener('click', openNewEvento);
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', e => {
    if (e.target.files[0]) {
      importData(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Week navigation
  document.getElementById('btn-prev-week').addEventListener('click', () => {
    currentWeekOffset--;
    renderGrid();
  });
  document.getElementById('btn-next-week').addEventListener('click', () => {
    currentWeekOffset++;
    renderGrid();
  });
  document.getElementById('btn-today').addEventListener('click', () => {
    currentWeekOffset = 0;
    renderGrid();
  });

  // Save buttons
  document.getElementById('btn-save-materia').addEventListener('click', saveMateria);
  document.getElementById('btn-save-evento').addEventListener('click', saveEvento);
  document.getElementById('btn-confirm-delete').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
  });

  // Add horario
  document.getElementById('btn-add-horario').addEventListener('click', addHorarioRow);

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

  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllModals();
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
}

// Arrancar cuando el DOM este listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init());
} else {
  init();
}
