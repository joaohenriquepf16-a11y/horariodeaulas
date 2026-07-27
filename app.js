// ============================================================
// Organizador de Horários Escolares
// Persistência local (localStorage). Drag & drop nativo.
// Exporta PDF com jsPDF + AutoTable.
// ============================================================

const STORAGE_KEY = "school_schedule_v1";

const DAYS = [
  { key: "seg", label: "Segunda-feira" },
  { key: "ter", label: "Terça-feira" },
  { key: "qua", label: "Quarta-feira" },
  { key: "qui", label: "Quinta-feira" },
  { key: "sex", label: "Sexta-feira" },
];

// Estrutura de linhas por tipo de turma.
// kind: "class" (aula) | "interval" (intervalo/almoço) | "shift" (rótulo turno)
// fullSpan=false → intervalo passa "por dentro" (colspan=6, Turma/Turno seguem por cima).
// fullSpan=true  → intervalo ocupa a linha inteira (colspan=8), quebrando Turma/Turno.
// Cotas de aulas por disciplina, por tipo de turma. A cota compara pelo
// NOME da disciplina (não por professor) — se dois professores ensinam MAT,
// ambos contam para a mesma cota. Chaves em MAIÚSCULAS.
const SUBJECT_QUOTAS = {
  regular: {
    "PORT":   6,
    "MAT":    5,
    "HIST":   2,
    "GEO":    2,
    "CIÊN":   2,
    "ED FÍS": 1,
    "CID":    1,
    "ART":    1,
  },
  regular_tarde: {
    "PORT":   6,
    "MAT":    5,
    "HIST":   2,
    "GEO":    2,
    "CIÊN":   2,
    "ED FÍS": 1,
    "CID":    1,
    "ART":    1,
  },
  integral: {
    "PORT":       8,
    "MAT":        8,
    "HIST":       3,
    "GEO":        3,
    "CIÊN":       3,
    "ED FÍS":     2,
    "CID":        1,
    "ART":        2,
    "ET RAC":     1,
    "ED SOC EMO": 1,
    "ED FINANC":  1,
    "F LEI":      1,
    "HAB FC MT":  2,
    "HAB FC PT":  2,
    "ING":        2,
  },
};

const LAYOUTS = {
  regular: {
    rows: [
      { kind: "class", turno: "Manhã", aula: "1ª", id: "m1" },
      { kind: "class", turno: "Manhã", aula: "2ª", id: "m2" },
      { kind: "interval", label: "INTERVALO", fullSpan: false },
      { kind: "class", turno: "Manhã", aula: "3ª", id: "m3" },
      { kind: "class", turno: "Manhã", aula: "4ª", id: "m4" },
    ],
  },
  regular_tarde: {
    rows: [
      { kind: "class", turno: "Tarde", aula: "1ª", id: "t1" },
      { kind: "class", turno: "Tarde", aula: "2ª", id: "t2" },
      { kind: "interval", label: "INTERVALO", fullSpan: false },
      { kind: "class", turno: "Tarde", aula: "3ª", id: "t3" },
      { kind: "class", turno: "Tarde", aula: "4ª", id: "t4" },
    ],
  },
  integral: {
    rows: [
      { kind: "class", turno: "Manhã", aula: "1ª", id: "m1" },
      { kind: "class", turno: "Manhã", aula: "2ª", id: "m2" },
      { kind: "interval", label: "INTERVALO", fullSpan: false },
      { kind: "class", turno: "Manhã", aula: "3ª", id: "m3" },
      { kind: "class", turno: "Manhã", aula: "4ª", id: "m4" },
      { kind: "interval", label: "INTERVALO DO ALMOÇO", fullSpan: true },
      { kind: "class", turno: "Tarde", aula: "5ª", id: "t5" },
      { kind: "class", turno: "Tarde", aula: "6ª", id: "t6" },
      { kind: "interval", label: "INTERVALO", fullSpan: false },
      { kind: "class", turno: "Tarde", aula: "7ª", id: "t7" },
      { kind: "class", turno: "Tarde", aula: "8ª", id: "t8" },
    ],
  },
};

// ------- Estado -------
let state = {
  className: "",
  classType: "regular",
  teachers: [], // { id, name, color, subjects: [] }
  schedule: {}, // { "rowId|dayKey": { teacherId, subject } }
};

// ------- Utils -------
function uid() { return Math.random().toString(36).slice(2, 10); }
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...state, ...JSON.parse(raw) };
  } catch (e) { console.warn("Falha ao carregar estado", e); }
}

function confirmModal(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <p class="modal-msg"></p>
        <div class="modal-actions">
          <button class="btn btn-ghost-dark" data-a="cancel">Cancelar</button>
          <button class="btn btn-danger" data-a="ok">Confirmar</button>
        </div>
      </div>
    `;
    overlay.querySelector(".modal-msg").textContent = message;
    const done = (v) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") done(false);
      else if (e.key === "Enter") done(true);
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(false);
      if (e.target.dataset.a === "ok") done(true);
      if (e.target.dataset.a === "cancel") done(false);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
  });
}

function toast(msg, type = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast show " + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = "toast"; }, 2200);
}

// Contraste: escolhe texto preto ou branco baseado na cor de fundo
function textColorFor(hex) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0,2),16);
  const g = parseInt(c.substring(2,4),16);
  const b = parseInt(c.substring(4,6),16);
  const yiq = (r*299 + g*587 + b*114) / 1000;
  return yiq >= 140 ? "#111827" : "#ffffff";
}

function slotKey(rowId, dayKey) { return `${rowId}|${dayKey}`; }

// Normaliza o nome de disciplina do usuário para casar com as chaves
// de SUBJECT_QUOTAS (ex.: POR -> PORT, CIEN -> CIÊN, ED FIS -> ED FÍS).
function normalizeSubject(name) {
  const raw = (name || "").trim().toUpperCase();
  const map = {
    "POR":       "PORT",
    "PORTUGUES": "PORT",
    "PORTUGUÊS": "PORT",
    "MATEMATICA":"MAT",
    "MATEMÁTICA":"MAT",
    "CIEN":      "CIÊN",
    "CIENCIAS":  "CIÊN",
    "CIÊNCIAS":  "CIÊN",
    "HISTORIA":  "HIST",
    "HISTÓRIA":  "HIST",
    "GEOGRAFIA": "GEO",
    "ED FIS":    "ED FÍS",
    "EDFIS":     "ED FÍS",
    "EDUCACAO FISICA":"ED FÍS",
    "EDUCAÇÃO FÍSICA":"ED FÍS",
    "CIDADANIA": "CID",
    "ARTE":      "ART",
    "ARTES":     "ART",
    "INGLES":    "ING",
    "INGLÊS":    "ING",
    "ETRAC":     "ET RAC",
    "ETICA E RACIOCINIO":"ET RAC",
    "ED SOC EMO":"ED SOC EMO",
    "ED FINANC": "ED FINANC",
    "ED FINANCEIRA":"ED FINANC",
    "F LEI":     "F LEI",
    "F. LEI":    "F LEI",
    "F.LEI":     "F LEI",
    "FORMACAO LEITORA":"F LEI",
    "F CID":     "F CID",
    "F. CID":    "F CID",
    "HAB FC MT": "HAB FC MT",
    "HAB. FC MT":"HAB FC MT",
    "HAB FC PT": "HAB FC PT",
    "HAB. FC PT":"HAB FC PT",
    "HAB FC. MT":"HAB FC MT",
    "HAB FC. PT":"HAB FC PT",
  };
  return map[raw] || raw;
}

// Retorna { subject: count } de usos atuais na grade (agrupado por
// disciplina normalizada).
function subjectUsageCounts() {
  const counts = {};
  for (const k of Object.keys(state.schedule)) {
    const e = state.schedule[k];
    const key = normalizeSubject(e.subject);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function renderQuotas() {
  const wrap = $("#quotasList");
  if (!wrap) return;
  const quotas = SUBJECT_QUOTAS[state.classType] || {};
  const used = subjectUsageCounts();
  wrap.innerHTML = "";
  const entries = Object.entries(quotas);
  if (entries.length === 0) {
    wrap.innerHTML = `<p class="hint">Sem cotas definidas para este tipo de turma.</p>`;
    return;
  }
  // Também mostra usos "extras" que não estão nas cotas
  const extras = Object.keys(used).filter(s => !(s in quotas));
  const totalPlanned = entries.reduce((a, [, v]) => a + v, 0);
  const totalUsed = Object.values(used).reduce((a, b) => a + b, 0);

  const summary = document.createElement("div");
  summary.className = "quota-summary";
  summary.innerHTML = `<b>Total:</b> ${totalUsed} / ${totalPlanned} aula(s) alocadas`;
  wrap.appendChild(summary);

  for (const [subject, planned] of entries) {
    const u = used[subject] || 0;
    const remaining = planned - u;
    const row = document.createElement("div");
    row.className = "quota-row" + (remaining === 0 ? " ok" : remaining < 0 ? " over" : "");
    row.innerHTML = `
      <span class="quota-name">${subject}</span>
      <span class="quota-count">
        <b>${u}</b> / ${planned}
        <span class="quota-remaining">${remaining > 0 ? `(faltam ${remaining})` : remaining < 0 ? `(excedeu ${-remaining})` : `(ok)`}</span>
      </span>
    `;
    wrap.appendChild(row);
  }
  if (extras.length > 0) {
    const sep = document.createElement("div");
    sep.className = "hint";
    sep.style.marginTop = "8px";
    sep.textContent = "Fora da cota:";
    wrap.appendChild(sep);
    for (const s of extras) {
      const row = document.createElement("div");
      row.className = "quota-row extra";
      row.innerHTML = `
        <span class="quota-name">${s}</span>
        <span class="quota-count"><b>${used[s]}</b> aula(s)</span>
      `;
      wrap.appendChild(row);
    }
  }
}

// ------- Professores -------
// subjectsInput: [{ name, qty }]
function addTeacher(name, color, subjectsInput) {
  if (!name) { toast("Informe o nome do professor.", "error"); return; }
  const cleaned = subjectsInput
    .map(s => ({ name: (s.name || "").trim(), qty: Math.max(0, parseInt(s.qty || 0, 10) || 0) }))
    .filter(s => s.name);
  if (cleaned.length === 0) { toast("Informe ao menos uma disciplina.", "error"); return; }
  const dup = state.teachers.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (dup) { toast("Já existe um professor com esse nome.", "error"); return; }
  // Estrutura interna mantém compatibilidade: subjects: [string] e
  // subjectQuotas: { subjectName: qty }.
  const subjects = cleaned.map(s => s.name.toUpperCase());
  const subjectQuotas = {};
  cleaned.forEach(s => { subjectQuotas[s.name.toUpperCase()] = s.qty; });
  state.teachers.push({
    id: uid(),
    name: name.toUpperCase(),
    color,
    subjects,
    subjectQuotas,
  });
  save();
  renderTeachers();
  renderGrid(); // recalcula cotas somadas
  toast("Professor adicionado.", "success");
}

// Conta quantas vezes cada (teacherId + subject exato) foi usada na grade.
function combinationUsageCount(teacherId, subject) {
  let n = 0;
  for (const k of Object.keys(state.schedule)) {
    const e = state.schedule[k];
    if (e.teacherId === teacherId && e.subject === subject) n++;
  }
  return n;
}

async function removeTeacher(id) {
  const t = state.teachers.find(x => x.id === id);
  if (!t) return;
  const ok = await confirmModal(`Remover ${t.name}? Todos os horários dele(a) serão limpos.`);
  if (!ok) return;
  state.teachers = state.teachers.filter(x => x.id !== id);
  // Limpa slots deste professor
  for (const k of Object.keys(state.schedule)) {
    if (state.schedule[k].teacherId === id) delete state.schedule[k];
  }
  save();
  renderTeachers();
  renderGrid();
  toast("Professor removido.");
}

function renderTeachers() {
  const list = $("#teachersList");
  list.innerHTML = "";
  if (state.teachers.length === 0) {
    list.innerHTML = `<p class="hint">Nenhum professor cadastrado ainda.</p>`;
    return;
  }
  for (const t of state.teachers) {
    const el = document.createElement("div");
    el.className = "teacher-item";
    el.innerHTML = `
      <div class="teacher-head">
        <span class="color-dot" style="background:${t.color}"></span>
        <span class="teacher-name">${t.name}</span>
        <button class="teacher-remove" title="Remover professor" data-id="${t.id}">×</button>
      </div>
      <div class="subject-chips"></div>
    `;
    const chipsWrap = el.querySelector(".subject-chips");
    let visibleChips = 0;
    for (const subject of t.subjects) {
      const planned = (t.subjectQuotas && t.subjectQuotas[subject] != null) ? t.subjectQuotas[subject] : null;
      const used = combinationUsageCount(t.id, subject);
      const remaining = planned == null ? null : (planned - used);
      // Se a cota já foi atingida (remaining <= 0 e planned > 0), oculta o chip
      // para não confundir. Se planned === 0 também não mostra.
      if (planned === 0) continue;
      if (planned != null && remaining <= 0) continue;
      // Se não há cota definida (compatibilidade), oculta quando já usado
      // pelo menos uma vez (comportamento anterior).
      if (planned == null && used > 0) continue;

      visibleChips++;
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.draggable = true;
      chip.style.background = t.color;
      chip.style.color = textColorFor(t.color);
      chip.dataset.teacherId = t.id;
      chip.dataset.subject = subject;
      const label = `${subject} - ${t.name}`;
      if (remaining != null) {
        chip.innerHTML = `${escapeHtml(label)}<span class="chip-count" title="Aulas restantes">${remaining}</span>`;
      } else {
        chip.textContent = label;
      }
      chip.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", JSON.stringify({ teacherId: t.id, subject }));
        e.dataTransfer.effectAllowed = "copyMove";
      });
      chipsWrap.appendChild(chip);
    }
    if (visibleChips === 0) {
      const done = document.createElement("span");
      done.className = "hint";
      done.textContent = "Todas as disciplinas já atribuídas.";
      chipsWrap.appendChild(done);
    }
    el.querySelector(".teacher-remove").addEventListener("click", () => removeTeacher(t.id));
    list.appendChild(el);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c]);
}

// Verifica se a combinação (teacherId + subject) já está em algum slot.
function isCombinationUsed(teacherId, subject) {
  for (const k of Object.keys(state.schedule)) {
    const e = state.schedule[k];
    if (e.teacherId === teacherId && e.subject === subject) return true;
  }
  return false;
}

// ------- Grade -------
function renderGrid() {
  const layout = LAYOUTS[state.classType];
  const wrap = $("#gridWrap");
  wrap.innerHTML = "";

  const table = document.createElement("table");
  table.className = "schedule";

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  ["Turma", "Turno", "Aula", ...DAYS.map(d => d.label)].forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  // ----- Cálculo dos rowspans de "Turma" e "Turno" -----
  // O rowspan em HTML conta TODAS as linhas visíveis, inclusive intervalos que
  // NÃO são fullSpan (esses passam por dentro do rowspan). Já intervalos
  // fullSpan quebram o rowspan (ocupam a linha inteira, inclusive Turma/Turno).
  //
  // Vamos varrer as linhas dividindo-as em blocos separados por intervalos
  // fullSpan. Dentro de cada bloco calculamos:
  //   turmaSpan = número de linhas do bloco (todas)
  //   turnoSpans = para cada turno, número de linhas do turno + intervalos
  //                que caem "dentro" desse turno.
  const rows = layout.rows;
  const turmaSpan = new Array(rows.length).fill(0); // rowspan a escrever nesta linha (0 = não escreve)
  const turnoSpan = new Array(rows.length).fill(0);

  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind === "interval" && rows[i].fullSpan) { i++; continue; }
    // Encontra fim do bloco: até o próximo fullSpan (exclusive) ou fim.
    let j = i;
    while (j < rows.length && !(rows[j].kind === "interval" && rows[j].fullSpan)) j++;
    // Bloco = [i, j)
    // Primeira linha de aula do bloco recebe rowspan Turma = j - i.
    let firstClassIdx = -1;
    for (let k = i; k < j; k++) { if (rows[k].kind === "class") { firstClassIdx = k; break; } }
    if (firstClassIdx !== -1) turmaSpan[firstClassIdx] = j - i;

    // Rowspans por turno dentro do bloco.
    // Estratégia: para cada turno, o rowspan vai da primeira aula desse turno
    // até a última aula do turno, incluindo intervalos entre elas.
    const seenTurnos = new Set();
    for (let k = i; k < j; k++) {
      if (rows[k].kind !== "class") continue;
      const t = rows[k].turno;
      if (seenTurnos.has(t)) continue;
      seenTurnos.add(t);
      // Última aula deste turno dentro do bloco:
      let lastIdx = k;
      for (let m = k; m < j; m++) {
        if (rows[m].kind === "class" && rows[m].turno === t) lastIdx = m;
      }
      turnoSpan[k] = lastIdx - k + 1;
    }
    i = j;
  }

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const tr = document.createElement("tr");

    if (row.kind === "interval") {
      const td = document.createElement("td");
      td.colSpan = row.fullSpan ? 8 : 6;
      td.textContent = row.label;
      tr.classList.add("interval");
      tr.appendChild(td);
      tbody.appendChild(tr);
      continue;
    }

    // Célula Turma
    if (turmaSpan[idx] > 0) {
      const tdTurma = document.createElement("td");
      tdTurma.className = "meta";
      tdTurma.rowSpan = turmaSpan[idx];
      tdTurma.textContent = state.className || "—";
      tr.appendChild(tdTurma);
    }

    // Célula Turno
    if (turnoSpan[idx] > 0) {
      const tdTurno = document.createElement("td");
      tdTurno.className = "meta";
      tdTurno.rowSpan = turnoSpan[idx];
      tdTurno.textContent = row.turno;
      tr.appendChild(tdTurno);
    }

    // Aula
    const tdAula = document.createElement("td");
    tdAula.className = "meta";
    tdAula.textContent = row.aula;
    tr.appendChild(tdAula);

    // Slots dos dias
    for (const day of DAYS) {
      const td = document.createElement("td");
      td.className = "slot";
      td.dataset.rowId = row.id;
      td.dataset.day = day.key;

      const key = slotKey(row.id, day.key);
      const entry = state.schedule[key];
      if (entry) {
        const t = state.teachers.find(x => x.id === entry.teacherId);
        if (t) {
          td.classList.add("filled");
          td.style.background = t.color;
          td.style.color = textColorFor(t.color);
          td.innerHTML = `${entry.subject} - ${t.name}<span class="remove-x" title="Remover">×</span>`;
          td.draggable = true;
          td.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("text/plain", JSON.stringify({
              teacherId: entry.teacherId, subject: entry.subject, fromKey: key
            }));
            e.dataTransfer.effectAllowed = "move";
          });
          td.querySelector(".remove-x").addEventListener("click", (ev) => {
            ev.stopPropagation();
            delete state.schedule[key];
            save(); renderGrid(); renderTeachers();
          });
        }
      }

      td.addEventListener("dragover", (e) => {
        e.preventDefault();
        td.classList.add("drag-over");
      });
      td.addEventListener("dragleave", () => td.classList.remove("drag-over"));
      td.addEventListener("drop", (e) => {
        e.preventDefault();
        td.classList.remove("drag-over");
        let payload;
        try { payload = JSON.parse(e.dataTransfer.getData("text/plain")); }
        catch { return; }
        handleDrop(row.id, day.key, payload);
      });

      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  renderQuotas();
}

// Verifica choque: mesmo professor não pode estar em duas turmas...
// Aqui operamos com UMA turma por vez. Choque relevante: mesmo horário na mesma turma
// já está ocupado por outro professor. Regra: só permitir sobrescrever se o slot estiver vazio
// OU se for o mesmo professor (troca de disciplina).
function handleDrop(rowId, dayKey, payload) {
  const targetKey = slotKey(rowId, dayKey);
  const existing = state.schedule[targetKey];

  // Se veio de outro slot (movimentação), remove a origem.
  if (payload.fromKey && payload.fromKey !== targetKey) {
    // Choque: se destino já ocupado por professor diferente, bloqueia.
    if (existing && existing.teacherId !== payload.teacherId) {
      toast("Choque de horário: este slot já tem outro professor.", "error");
      return;
    }
    delete state.schedule[payload.fromKey];
  } else if (existing && existing.teacherId !== payload.teacherId) {
    toast("Choque de horário: este slot já tem outro professor.", "error");
    return;
  }

  state.schedule[targetKey] = { teacherId: payload.teacherId, subject: payload.subject };
  save();
  renderGrid();
  renderTeachers();
}

// ------- PDF -------
function exportPDF() {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      toast("Biblioteca de PDF não carregou. Verifique sua conexão.", "error");
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    // Compatibilidade entre versões do autotable: método de instância ou função global
    const runAutoTable = (options) => {
      if (typeof doc.autoTable === "function") return doc.autoTable(options);
      if (window.jspdf && typeof window.jspdf.autoTable === "function") return window.jspdf.autoTable(doc, options);
      throw new Error("jspdf-autotable indisponível");
    };
    _exportPDFBody(doc, runAutoTable);
  } catch (err) {
    console.error(err);
    toast("Falha ao gerar PDF: " + (err && err.message ? err.message : err), "error");
  }
}

function _exportPDFBody(doc, runAutoTable) {

  const typeLabel = {
    regular: "Regular (Manhã)",
    regular_tarde: "Regular (Tarde)",
    integral: "Integral (Manhã + Tarde)",
  }[state.classType] || "Regular";
  const title = `Horário — ${state.className || "Turma"} (${typeLabel})`;
  doc.setFontSize(14);
  doc.text(title, 40, 36);

  const layout = LAYOUTS[state.classType];
  const head = [["Turma", "Turno", "Aula", ...DAYS.map(d => d.label)]];
  const body = [];

  const rowsL = layout.rows;
  const turmaSpanP = new Array(rowsL.length).fill(0);
  const turnoSpanP = new Array(rowsL.length).fill(0);
  {
    let i = 0;
    while (i < rowsL.length) {
      if (rowsL[i].kind === "interval" && rowsL[i].fullSpan) { i++; continue; }
      let j = i;
      while (j < rowsL.length && !(rowsL[j].kind === "interval" && rowsL[j].fullSpan)) j++;
      let firstClassIdx = -1;
      for (let k = i; k < j; k++) { if (rowsL[k].kind === "class") { firstClassIdx = k; break; } }
      if (firstClassIdx !== -1) turmaSpanP[firstClassIdx] = j - i;
      const seen = new Set();
      for (let k = i; k < j; k++) {
        if (rowsL[k].kind !== "class") continue;
        const t = rowsL[k].turno;
        if (seen.has(t)) continue;
        seen.add(t);
        let lastIdx = k;
        for (let m = k; m < j; m++) if (rowsL[m].kind === "class" && rowsL[m].turno === t) lastIdx = m;
        turnoSpanP[k] = lastIdx - k + 1;
      }
      i = j;
    }
  }

  for (let idx = 0; idx < rowsL.length; idx++) {
    const row = rowsL[idx];
    if (row.kind === "interval") {
      const colSpan = row.fullSpan ? 8 : 6;
      body.push([{ content: row.label, colSpan, styles: { halign: "center", fillColor: [243,244,246], fontStyle: "bold" } }]);
      continue;
    }
    const cells = [];
    if (turmaSpanP[idx] > 0) {
      cells.push({ content: state.className || "—", rowSpan: turmaSpanP[idx], styles: { valign: "middle", halign: "center", fillColor: [238,242,255], fontStyle: "bold" } });
    }
    if (turnoSpanP[idx] > 0) {
      cells.push({ content: row.turno, rowSpan: turnoSpanP[idx], styles: { valign: "middle", halign: "center", fillColor: [238,242,255], fontStyle: "bold" } });
    }
    cells.push({ content: row.aula, styles: { halign: "center", fillColor: [238,242,255], fontStyle: "bold" } });

    for (const day of DAYS) {
      const key = slotKey(row.id, day.key);
      const entry = state.schedule[key];
      if (entry) {
        const t = state.teachers.find(x => x.id === entry.teacherId);
        if (t) {
          const rgb = hexToRgb(t.color);
          const tc = textColorFor(t.color);
          cells.push({
            content: `${entry.subject} - ${t.name}`,
            styles: {
              fillColor: [rgb.r, rgb.g, rgb.b],
              textColor: tc === "#ffffff" ? [255,255,255] : [17,24,39],
              fontStyle: "bold",
              halign: "center"
            }
          });
          continue;
        }
      }
      cells.push({ content: "", styles: { halign: "center" } });
    }
    body.push(cells);
  }

  runAutoTable({
    head,
    body,
    startY: 52,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 4, lineColor: [156,163,175], lineWidth: 0.5 },
    headStyles: { fillColor: [110,192,110], textColor: [31,41,55], fontStyle: "bold", halign: "center" },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 55 },
      2: { cellWidth: 40 },
    },
  });

  const filename = `horario_${(state.className || "turma").replace(/\s+/g,"_")}.pdf`;
  downloadPdf(doc, filename);
}

// Download direto do PDF: cria um link com atributo `download` e clica.
// Fora de iframes com sandbox, isso salva imediatamente na pasta Downloads.
function downloadPdf(doc, filename) {
  try {
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    toast("PDF baixado.", "success");
  } catch (err) {
    console.error(err);
    try { doc.save(filename); }
    catch (e) { toast("Não foi possível baixar o PDF neste navegador.", "error"); }
  }
}

function hexToRgb(hex) {
  const c = hex.replace("#", "");
  return {
    r: parseInt(c.substring(0,2),16),
    g: parseInt(c.substring(2,4),16),
    b: parseInt(c.substring(4,6),16),
  };
}

// ------- Preenchimento automático -------
// Estratégia:
// 1. Não sobrescreve slots que o usuário já preencheu manualmente. Apenas
//    preenche os slots vazios.
// 2. Para cada professor cadastrado, distribui suas disciplinas nos slots
//    vazios, respeitando: (a) nenhum choque (só um professor por slot);
//    (b) evita repetir a mesma disciplina no mesmo dia; (c) tenta espalhar
//    entre dias diferentes; (d) tenta não colocar a mesma disciplina em
//    aulas seguidas.
// 3. O usuário pode ajustar manualmente depois: arrastar, remover ou trocar.
function autoFill() {
  const layout = LAYOUTS[state.classType];
  const classRows = layout.rows.filter(r => r.kind === "class");
  if (state.teachers.length === 0) {
    toast("Cadastre professores antes de usar o preenchimento automático.", "error");
    return;
  }
  if (classRows.length === 0) return;

  // Coleta todos os slots livres com contexto (rowId, dayKey, dayIdx, rowIdxInLayout).
  const freeSlots = [];
  classRows.forEach((row, rowIdx) => {
    DAYS.forEach((day, dayIdx) => {
      const key = slotKey(row.id, day.key);
      if (!state.schedule[key]) freeSlots.push({ rowId: row.id, dayKey: day.key, dayIdx, rowIdx });
    });
  });

  if (freeSlots.length === 0) {
    toast("A grade já está totalmente preenchida.");
    return;
  }

  // Monta a lista de "unidades a alocar". Se houver cotas definidas para o
  // tipo de turma, respeitamos: cada disciplina recebe (cota - já usado)
  // aulas. Quando várias professores lecionam a mesma disciplina, a cota
  // é dividida entre eles (round-robin). Se não houver cota, cai para o
  // comportamento anterior (distribuição igualitária).
  const quotas = SUBJECT_QUOTAS[state.classType] || {};
  const currentUsage = subjectUsageCounts();
  const items = [];

  if (Object.keys(quotas).length > 0) {
    // Agrupa professores por disciplina normalizada
    const bySubject = {}; // normalizedSubject -> [{teacherId, rawSubject}]
    state.teachers.forEach(t => {
      t.subjects.forEach(s => {
        const n = normalizeSubject(s);
        (bySubject[n] = bySubject[n] || []).push({ teacherId: t.id, rawSubject: s });
      });
    });
    for (const [normSubj, planned] of Object.entries(quotas)) {
      const already = currentUsage[normSubj] || 0;
      let need = planned - already;
      if (need <= 0) continue;
      const providers = bySubject[normSubj] || [];
      if (providers.length === 0) continue; // Nenhum professor leciona: pula
      // Distribui `need` unidades entre providers round-robin
      let pi = 0;
      while (need > 0) {
        const p = providers[pi % providers.length];
        items.push({ teacherId: p.teacherId, subject: p.rawSubject, count: 1 });
        need--; pi++;
      }
    }
  } else {
    // Fallback: distribuição igualitária pelos slots livres
    const totalUnits = freeSlots.length;
    const pool = [];
    state.teachers.forEach(t => {
      t.subjects.forEach(s => pool.push({ teacherId: t.id, subject: s }));
    });
    if (pool.length === 0) return;
    for (let k = 0; k < totalUnits; k++) {
      const p = pool[k % pool.length];
      items.push({ teacherId: p.teacherId, subject: p.subject, count: 1 });
    }
  }
  if (items.length === 0) {
    toast("Cotas já atendidas ou nenhum professor cobre as disciplinas.", "error");
    return;
  }

  // Estado auxiliar: contagem por (professor,dia) e (disciplina,dia)
  const teacherDayCount = {}; // `${teacherId}|${dayKey}` -> n
  const subjectDayCount = {}; // `${teacherId}|${subject}|${dayKey}` -> n
  // Marca os slots já ocupados manualmente para não sobrescrever e para
  // considerar no cálculo de "dias que já têm esse professor".
  Object.entries(state.schedule).forEach(([k, entry]) => {
    const [, dayKey] = k.split("|");
    teacherDayCount[`${entry.teacherId}|${dayKey}`] = (teacherDayCount[`${entry.teacherId}|${dayKey}`] || 0) + 1;
    subjectDayCount[`${entry.teacherId}|${entry.subject}|${dayKey}`] = (subjectDayCount[`${entry.teacherId}|${entry.subject}|${dayKey}`] || 0) + 1;
  });

  // Baralha os slots livres para variar entre execuções
  shuffle(freeSlots);

  // Expande items em units
  const units = items.map(it => ({ teacherId: it.teacherId, subject: it.subject }));
  shuffle(units);

  // Cria uma cópia mutável do schedule para tentar
  const newSchedule = { ...state.schedule };

  // Função de custo: menor é melhor. Penaliza repetição no mesmo dia.
  function scoreSlot(unit, slot) {
    const td = teacherDayCount[`${unit.teacherId}|${slot.dayKey}`] || 0;
    const sd = subjectDayCount[`${unit.teacherId}|${unit.subject}|${slot.dayKey}`] || 0;
    // Fortíssima penalidade para 2ª ocorrência da mesma disciplina no dia
    return sd * 100 + td * 10;
  }

  // Aloca cada unit no melhor slot livre disponível
  const usedSlotKeys = new Set();
  for (const unit of units) {
    let best = null;
    let bestScore = Infinity;
    for (const slot of freeSlots) {
      const sk = slotKey(slot.rowId, slot.dayKey);
      if (usedSlotKeys.has(sk)) continue;
      const sc = scoreSlot(unit, slot);
      if (sc < bestScore) { bestScore = sc; best = slot; if (sc === 0) break; }
    }
    if (!best) break;
    const sk = slotKey(best.rowId, best.dayKey);
    newSchedule[sk] = { teacherId: unit.teacherId, subject: unit.subject };
    usedSlotKeys.add(sk);
    teacherDayCount[`${unit.teacherId}|${best.dayKey}`] = (teacherDayCount[`${unit.teacherId}|${best.dayKey}`] || 0) + 1;
    subjectDayCount[`${unit.teacherId}|${unit.subject}|${best.dayKey}`] = (subjectDayCount[`${unit.teacherId}|${unit.subject}|${best.dayKey}`] || 0) + 1;
  }

  state.schedule = newSchedule;
  save();
  renderGrid();
  renderTeachers();
  toast("Preenchimento automático concluído. Faça os ajustes que quiser.", "success");
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ------- Builder de disciplinas do cadastro -------
function addSubjectRow(initial) {
  const wrap = $("#subjectsBuilder");
  const row = document.createElement("div");
  row.className = "subject-row";
  row.innerHTML = `
    <input type="text" class="subject-name" placeholder="Disciplina (ex.: MAT)" />
    <input type="number" class="subject-qty" placeholder="Qtd" min="0" step="1" value="1" />
    <button type="button" class="del-subject" title="Remover disciplina">×</button>
  `;
  if (initial) {
    row.querySelector(".subject-name").value = initial.name || "";
    if (initial.qty != null) row.querySelector(".subject-qty").value = initial.qty;
  }
  row.querySelector(".del-subject").addEventListener("click", () => {
    row.remove();
    if ($("#subjectsBuilder").children.length === 0) addSubjectRow();
  });
  wrap.appendChild(row);
}

function collectSubjectsFromBuilder() {
  return $$("#subjectsBuilder .subject-row").map(r => ({
    name: r.querySelector(".subject-name").value,
    qty:  r.querySelector(".subject-qty").value,
  }));
}

function resetSubjectsBuilder() {
  $("#subjectsBuilder").innerHTML = "";
  addSubjectRow();
}

// ------- Init -------
function bindUI() {
  $("#className").addEventListener("input", (e) => {
    state.className = e.target.value; save(); renderGrid();
  });
  $("#classType").addEventListener("change", (e) => {
    state.classType = e.target.value; save(); renderGrid();
  });
  $("#btnAddSubjectRow").addEventListener("click", () => addSubjectRow());
  $("#btnAddTeacher").addEventListener("click", () => {
    const name = $("#teacherName").value.trim();
    const color = $("#teacherColor").value;
    const subjects = collectSubjectsFromBuilder();
    addTeacher(name, color, subjects);
    $("#teacherName").value = "";
    resetSubjectsBuilder();
  });
  $("#btnAutoFill").addEventListener("click", () => {
    autoFill();
  });
  $("#btnClearGrid").addEventListener("click", async () => {
    const ok = await confirmModal("Limpar todos os horários da grade?");
    if (!ok) return;
    state.schedule = {}; save(); renderGrid(); renderTeachers();
    toast("Grade limpa.");
  });
  $("#btnExportPdf").addEventListener("click", exportPDF);
}

function seedIfEmpty() {
  if (state.teachers.length === 0 && !state.className) {
    // Semente com base nos exemplos anexados (didático).
    state.className = "4° A";
    state.classType = "regular";
    state.teachers = [
      { id: uid(), name: "MARIANA", color: "#c6e0f5",
        subjects: ["POR","MAT","CIÊN"],
        subjectQuotas: { "POR": 6, "MAT": 5, "CIÊN": 2 } },
      { id: uid(), name: "JOÃO", color: "#f8cbad",
        subjects: ["HIST","GEO","ED FÍS","CID","ART"],
        subjectQuotas: { "HIST": 2, "GEO": 2, "ED FÍS": 1, "CID": 1, "ART": 1 } },
    ];
    save();
  }
}

function init() {
  load();
  seedIfEmpty();
  $("#className").value = state.className || "";
  $("#classType").value = state.classType || "regular";
  bindUI();
  resetSubjectsBuilder();
  renderTeachers();
  renderGrid();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
