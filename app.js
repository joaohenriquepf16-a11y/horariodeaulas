// ============================================================
// Organizador de Horários Escolares
// Persistência local (localStorage). Drag & drop nativo.
// Exporta PDF com jsPDF + AutoTable.
// Suporta múltiplas turmas e detecta choque de professor
// entre turmas diferentes no mesmo dia+horário.
// ============================================================

const STORAGE_KEY = "school_schedule_v3";
const LEGACY_V2_KEY = "school_schedule_v2";
const LEGACY_STORAGE_KEY = "school_schedule_v1";

const DAYS = [
  { key: "seg", label: "Segunda-feira" },
  { key: "ter", label: "Terça-feira" },
  { key: "qua", label: "Quarta-feira" },
  { key: "qui", label: "Quinta-feira" },
  { key: "sex", label: "Sexta-feira" },
];

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

// Rótulo canônico de horário para checar choque entre turmas.
// Combina turno + número da aula, ignorando o id específico do layout
// (ex.: "m5" vs "t5") para que "Tarde 5ª" seja o mesmo em qualquer layout.
function slotTimeLabel(classType, rowId) {
  const layout = LAYOUTS[classType];
  if (!layout) return rowId;
  const row = layout.rows.find(r => r.id === rowId);
  if (!row) return rowId;
  return `${row.turno}|${row.aula}`;
}

// ------- Estado -------
// Estrutura v3 (cadastro de professores POR turma):
// state = {
//   classes: [ {
//     id, name, classType,
//     teachers: [ { id, name, color, subjects, subjectQuotas } ],
//     schedule: { "rowId|dayKey": {teacherId,subject} }
//   } ],
//   activeClassId: "..."
// }
let state = {
  classes: [],
  activeClassId: null,
};

// Retorna os professores da turma ativa (nunca a lista global).
function activeTeachers() {
  const cls = activeClass();
  return cls ? (cls.teachers || []) : [];
}

// ------- Utils -------
function uid() { return Math.random().toString(36).slice(2, 10); }
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function activeClass() {
  return state.classes.find(c => c.id === state.activeClassId) || null;
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { classes: parsed.classes || [], activeClassId: parsed.activeClassId || null };
      // Garante o array por turma
      state.classes.forEach(c => { if (!Array.isArray(c.teachers)) c.teachers = []; });
      return;
    }
    // Migração v2 -> v3: professores globais são replicados em cada turma.
    const v2raw = localStorage.getItem(LEGACY_V2_KEY);
    if (v2raw) {
      const old = JSON.parse(v2raw);
      const globalTeachers = old.teachers || [];
      const classes = (old.classes || []).map(c => ({
        id: c.id,
        name: c.name,
        classType: c.classType || "regular",
        schedule: c.schedule || {},
        // Cada turma recebe uma cópia independente da lista global
        teachers: globalTeachers.map(t => ({
          id: uid(),                              // novo id local por turma
          name: t.name,
          color: t.color,
          subjects: [...(t.subjects || [])],
          subjectQuotas: { ...(t.subjectQuotas || {}) },
          _legacyId: t.id,                        // usado para reidratar schedule
        })),
      }));
      // Reidrata schedule: teacherId antigo -> novo teacherId por turma
      for (const c of classes) {
        const map = {};
        c.teachers.forEach(t => { map[t._legacyId] = t.id; });
        c.teachers.forEach(t => { delete t._legacyId; });
        for (const k of Object.keys(c.schedule)) {
          const e = c.schedule[k];
          if (e && map[e.teacherId]) e.teacherId = map[e.teacherId];
        }
      }
      state.classes = classes;
      state.activeClassId = old.activeClassId || (classes[0] ? classes[0].id : null);
      save();
      return;
    }
    // Migração v1 (turma única, professores globais) -> v3
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const old = JSON.parse(legacy);
      const cid = uid();
      state.classes = [{
        id: cid,
        name: old.className || "Turma",
        classType: old.classType || "regular",
        schedule: old.schedule || {},
        teachers: old.teachers || [],
      }];
      state.activeClassId = cid;
      save();
    }
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
  toast._t = setTimeout(() => { el.className = "toast"; }, 2600);
}

function textColorFor(hex) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0,2),16);
  const g = parseInt(c.substring(2,4),16);
  const b = parseInt(c.substring(4,6),16);
  const yiq = (r*299 + g*587 + b*114) / 1000;
  return yiq >= 140 ? "#111827" : "#ffffff";
}

function slotKey(rowId, dayKey) { return `${rowId}|${dayKey}`; }

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

function subjectUsageCounts() {
  const counts = {};
  const cls = activeClass();
  if (!cls) return counts;
  for (const k of Object.keys(cls.schedule)) {
    const e = cls.schedule[k];
    const key = normalizeSubject(e.subject);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function renderQuotas() {
  const wrap = $("#quotasList");
  if (!wrap) return;
  const cls = activeClass();
  if (!cls) { wrap.innerHTML = `<p class="hint">Selecione uma turma.</p>`; return; }
  const quotas = SUBJECT_QUOTAS[cls.classType] || {};
  const used = subjectUsageCounts();
  wrap.innerHTML = "";
  const entries = Object.entries(quotas);
  if (entries.length === 0) {
    wrap.innerHTML = `<p class="hint">Sem cotas definidas para este tipo de turma.</p>`;
    return;
  }
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

// ------- Turmas -------
function addClass(name, classType) {
  name = (name || "").trim();
  if (!name) { toast("Informe o nome da turma.", "error"); return; }
  const dup = state.classes.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (dup) { toast("Já existe uma turma com esse nome.", "error"); return; }
  const cls = {
    id: uid(),
    name,
    classType: classType || "regular",
    schedule: {},
    teachers: [],
  };
  state.classes.push(cls);
  state.activeClassId = cls.id;
  save();
  renderClasses();
  renderTeachers();
  renderGrid();
  toast(`Turma "${name}" adicionada.`, "success");
}

async function removeClass(id) {
  const cls = state.classes.find(c => c.id === id);
  if (!cls) return;
  const ok = await confirmModal(`Excluir a turma "${cls.name}"? Todos os horários dela serão perdidos.`);
  if (!ok) return;
  state.classes = state.classes.filter(c => c.id !== id);
  if (state.activeClassId === id) {
    state.activeClassId = state.classes[0] ? state.classes[0].id : null;
  }
  save();
  renderClasses();
  renderTeachers();
  renderGrid();
  toast("Turma excluída.");
}

function selectClass(id) {
  if (!state.classes.find(c => c.id === id)) return;
  state.activeClassId = id;
  save();
  renderClasses();
  renderTeachers();
  renderGrid();
}

function renderClasses() {
  const list = $("#classesList");
  if (!list) return;
  list.innerHTML = "";
  if (state.classes.length === 0) {
    list.innerHTML = `<p class="hint">Nenhuma turma cadastrada. Adicione uma abaixo.</p>`;
    return;
  }
  const typeLabel = {
    regular: "Regular (Manhã)",
    regular_tarde: "Regular (Tarde)",
    integral: "Integral (M+T)",
  };
  for (const c of state.classes) {
    const el = document.createElement("div");
    el.className = "class-item" + (c.id === state.activeClassId ? " active" : "");
    el.innerHTML = `
      <div class="class-info">
        <span class="class-name">${escapeHtml(c.name)}</span>
        <span class="class-type">${typeLabel[c.classType] || c.classType}</span>
      </div>
      <div class="class-actions">
        <button class="btn btn-sm btn-ghost-dark" data-act="select" data-id="${c.id}">Selecionar</button>
        <button class="class-remove" title="Excluir turma" data-id="${c.id}">×</button>
      </div>
    `;
    el.querySelector('[data-act="select"]').addEventListener("click", () => selectClass(c.id));
    el.querySelector(".class-remove").addEventListener("click", () => removeClass(c.id));
    list.appendChild(el);
  }
}

// ------- Professores (por turma) -------
function addTeacher(name, color, subjectsInput) {
  const cls = activeClass();
  if (!cls) { toast("Selecione uma turma antes de cadastrar professores.", "error"); return; }
  if (!name) { toast("Informe o nome do professor.", "error"); return; }
  const cleaned = subjectsInput
    .map(s => ({ name: (s.name || "").trim(), qty: Math.max(0, parseInt(s.qty || 0, 10) || 0) }))
    .filter(s => s.name);
  if (cleaned.length === 0) { toast("Informe ao menos uma disciplina.", "error"); return; }
  cls.teachers = cls.teachers || [];
  const dup = cls.teachers.find(t => t.name.toLowerCase() === name.toLowerCase());

  // Se o professor já existe nesta turma, acrescenta/atualiza disciplinas em vez de bloquear.
  if (dup) {
    dup.subjects = Array.isArray(dup.subjects) ? dup.subjects : [];
    dup.subjectQuotas = dup.subjectQuotas || {};
    let added = 0;
    let updated = 0;
    for (const s of cleaned) {
      const subj = s.name.toUpperCase();
      if (dup.subjects.includes(subj)) {
        // Disciplina já existia — soma a nova quantidade à quota existente
        dup.subjectQuotas[subj] = (dup.subjectQuotas[subj] || 0) + s.qty;
        updated++;
      } else {
        dup.subjects.push(subj);
        dup.subjectQuotas[subj] = s.qty;
        added++;
      }
    }
    // Atualiza a cor se o usuário escolheu uma diferente
    if (color) dup.color = color;
    save();
    renderTeachers();
    renderGrid();
    if (added > 0 && updated > 0) {
      toast(`${dup.name}: ${added} disciplina(s) adicionada(s), ${updated} atualizada(s).`, "success");
    } else if (added > 0) {
      toast(`${added} disciplina(s) adicionada(s) a ${dup.name}.`, "success");
    } else {
      toast(`Quantidades atualizadas para ${dup.name}.`, "success");
    }
    return;
  }

  const subjects = cleaned.map(s => s.name.toUpperCase());
  const subjectQuotas = {};
  cleaned.forEach(s => { subjectQuotas[s.name.toUpperCase()] = s.qty; });
  cls.teachers.push({
    id: uid(),
    name: name.toUpperCase(),
    color,
    subjects,
    subjectQuotas,
  });
  save();
  renderTeachers();
  renderGrid();
  toast("Professor adicionado à turma.", "success");
}

// Conta usos por (professor, disciplina) — apenas na turma ativa.
function combinationUsageCount(teacherId, subject) {
  const cls = activeClass();
  if (!cls) return 0;
  let n = 0;
  for (const k of Object.keys(cls.schedule)) {
    const e = cls.schedule[k];
    if (e.teacherId === teacherId && e.subject === subject) n++;
  }
  return n;
}

async function removeTeacher(id) {
  const cls = activeClass();
  if (!cls) return;
  const t = (cls.teachers || []).find(x => x.id === id);
  if (!t) return;
  const ok = await confirmModal(`Remover ${t.name} da turma "${cls.name}"? Os horários dele(a) nesta turma serão limpos. Outras turmas não serão afetadas.`);
  if (!ok) return;
  cls.teachers = (cls.teachers || []).filter(x => x.id !== id);
  // Limpa slots deste professor APENAS na turma ativa
  for (const k of Object.keys(cls.schedule)) {
    if (cls.schedule[k].teacherId === id) delete cls.schedule[k];
  }
  save();
  renderTeachers();
  renderGrid();
  toast("Professor removido desta turma.");
}

function renderTeachers() {
  const list = $("#teachersList");
  list.innerHTML = "";
  const cls = activeClass();
  if (!cls) {
    list.innerHTML = `<p class="hint">Selecione uma turma para ver os professores.</p>`;
    return;
  }
  const teachers = cls.teachers || [];
  if (teachers.length === 0) {
    list.innerHTML = `<p class="hint">Nenhum professor cadastrado nesta turma ainda.</p>`;
    return;
  }
  for (const t of teachers) {
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
      if (planned === 0) continue;
      if (planned != null && remaining <= 0) continue;
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

// ------- Verificação de choque entre turmas -------
// Como agora cada turma tem sua própria lista de professores, o "mesmo"
// professor é identificado pelo NOME (uppercase) entre turmas diferentes.
function teacherNameById(cls, teacherId) {
  const t = (cls.teachers || []).find(x => x.id === teacherId);
  return t ? (t.name || "").toUpperCase() : null;
}

function findCrossClassConflict(teacherName, targetClassId, targetClassType, targetRowId, targetDayKey) {
  if (!teacherName) return null;
  const targetLabel = slotTimeLabel(targetClassType, targetRowId);
  for (const cls of state.classes) {
    if (cls.id === targetClassId) continue;
    for (const k of Object.keys(cls.schedule)) {
      const entry = cls.schedule[k];
      const otherName = teacherNameById(cls, entry.teacherId);
      if (!otherName || otherName !== teacherName) continue;
      const [rowId, dayKey] = k.split("|");
      if (dayKey !== targetDayKey) continue;
      const otherLabel = slotTimeLabel(cls.classType, rowId);
      if (otherLabel === targetLabel) {
        return { cls, rowId, dayKey };
      }
    }
  }
  return null;
}

// ------- Grade -------
function renderGrid() {
  const wrap = $("#gridWrap");
  wrap.innerHTML = "";
  const cls = activeClass();
  if (!cls) {
    wrap.innerHTML = `<div class="empty-grid"><p>Nenhuma turma selecionada.</p><p class="hint">Adicione uma turma para começar.</p></div>`;
    renderQuotas();
    return;
  }
  const layout = LAYOUTS[cls.classType];

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

  const rows = layout.rows;
  const turmaSpan = new Array(rows.length).fill(0);
  const turnoSpan = new Array(rows.length).fill(0);

  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind === "interval" && rows[i].fullSpan) { i++; continue; }
    let j = i;
    while (j < rows.length && !(rows[j].kind === "interval" && rows[j].fullSpan)) j++;
    let firstClassIdx = -1;
    for (let k = i; k < j; k++) { if (rows[k].kind === "class") { firstClassIdx = k; break; } }
    if (firstClassIdx !== -1) turmaSpan[firstClassIdx] = j - i;

    const seenTurnos = new Set();
    for (let k = i; k < j; k++) {
      if (rows[k].kind !== "class") continue;
      const t = rows[k].turno;
      if (seenTurnos.has(t)) continue;
      seenTurnos.add(t);
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

    if (turmaSpan[idx] > 0) {
      const tdTurma = document.createElement("td");
      tdTurma.className = "meta";
      tdTurma.rowSpan = turmaSpan[idx];
      tdTurma.textContent = cls.name || "—";
      tr.appendChild(tdTurma);
    }

    if (turnoSpan[idx] > 0) {
      const tdTurno = document.createElement("td");
      tdTurno.className = "meta";
      tdTurno.rowSpan = turnoSpan[idx];
      tdTurno.textContent = row.turno;
      tr.appendChild(tdTurno);
    }

    const tdAula = document.createElement("td");
    tdAula.className = "meta";
    tdAula.textContent = row.aula;
    tr.appendChild(tdAula);

    for (const day of DAYS) {
      const td = document.createElement("td");
      td.className = "slot";
      td.dataset.rowId = row.id;
      td.dataset.day = day.key;

      const key = slotKey(row.id, day.key);
      const entry = cls.schedule[key];
      if (entry) {
        const t = (cls.teachers || []).find(x => x.id === entry.teacherId);
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
            delete cls.schedule[key];
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

function handleDrop(rowId, dayKey, payload) {
  const cls = activeClass();
  if (!cls) return;
  const targetKey = slotKey(rowId, dayKey);
  const existing = cls.schedule[targetKey];

  // 1. Choque na mesma turma (mesmo slot já ocupado por outro professor)
  if (payload.fromKey && payload.fromKey !== targetKey) {
    if (existing && existing.teacherId !== payload.teacherId) {
      toast("Choque de horário: este slot já tem outro professor.", "error");
      return;
    }
  } else if (existing && existing.teacherId !== payload.teacherId) {
    toast("Choque de horário: este slot já tem outro professor.", "error");
    return;
  }

  // 2. Choque entre turmas: um professor com o MESMO NOME não pode estar em
  //    duas turmas no mesmo dia+horário (mesmo turno e mesma aula).
  const teacher = (cls.teachers || []).find(x => x.id === payload.teacherId);
  const teacherNameUp = teacher ? (teacher.name || "").toUpperCase() : null;
  const conflict = findCrossClassConflict(
    teacherNameUp, cls.id, cls.classType, rowId, dayKey
  );
  if (conflict) {
    const dayLabel = DAYS.find(d => d.key === dayKey)?.label || dayKey;
    const otherRow = LAYOUTS[conflict.cls.classType].rows.find(r => r.id === conflict.rowId);
    const aula = otherRow ? `${otherRow.turno} — ${otherRow.aula}` : conflict.rowId;
    toast(
      `Choque entre turmas: ${teacher ? teacher.name : "o professor"} já está na turma "${conflict.cls.name}" em ${dayLabel} (${aula}).`,
      "error"
    );
    return;
  }

  // Só remove a origem depois que todas as verificações passaram
  if (payload.fromKey && payload.fromKey !== targetKey) {
    // A origem pode estar em outra turma? Não — só arrastamos dentro da mesma turma ativa,
    // pois o payload de origem foi criado no render da turma atual.
    delete cls.schedule[payload.fromKey];
  }

  cls.schedule[targetKey] = { teacherId: payload.teacherId, subject: payload.subject };
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
    const cls = activeClass();
    if (!cls) { toast("Selecione uma turma antes de exportar.", "error"); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const runAutoTable = (options) => {
      if (typeof doc.autoTable === "function") return doc.autoTable(options);
      if (window.jspdf && typeof window.jspdf.autoTable === "function") return window.jspdf.autoTable(doc, options);
      throw new Error("jspdf-autotable indisponível");
    };
    _exportPDFBody(doc, runAutoTable, cls);
  } catch (err) {
    console.error(err);
    toast("Falha ao gerar PDF: " + (err && err.message ? err.message : err), "error");
  }
}

function _exportPDFBody(doc, runAutoTable, cls) {
  const typeLabel = {
    regular: "Regular (Manhã)",
    regular_tarde: "Regular (Tarde)",
    integral: "Integral (Manhã + Tarde)",
  }[cls.classType] || "Regular";
  const title = `Horário — ${cls.name || "Turma"} (${typeLabel})`;
  doc.setFontSize(14);
  doc.text(title, 40, 36);

  const layout = LAYOUTS[cls.classType];
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
      cells.push({ content: cls.name || "—", rowSpan: turmaSpanP[idx], styles: { valign: "middle", halign: "center", fillColor: [238,242,255], fontStyle: "bold" } });
    }
    if (turnoSpanP[idx] > 0) {
      cells.push({ content: row.turno, rowSpan: turnoSpanP[idx], styles: { valign: "middle", halign: "center", fillColor: [238,242,255], fontStyle: "bold" } });
    }
    cells.push({ content: row.aula, styles: { halign: "center", fillColor: [238,242,255], fontStyle: "bold" } });

    for (const day of DAYS) {
      const key = slotKey(row.id, day.key);
      const entry = cls.schedule[key];
      if (entry) {
        const t = (cls.teachers || []).find(x => x.id === entry.teacherId);
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

  const filename = `horario_${(cls.name || "turma").replace(/\s+/g,"_")}.pdf`;
  downloadPdf(doc, filename);
}

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
function autoFill() {
  const cls = activeClass();
  if (!cls) { toast("Selecione uma turma antes de usar o preenchimento automático.", "error"); return; }
  const layout = LAYOUTS[cls.classType];
  const classRows = layout.rows.filter(r => r.kind === "class");
  const teachersInClass = cls.teachers || [];
  if (teachersInClass.length === 0) {
    toast("Cadastre professores nesta turma antes de usar o preenchimento automático.", "error");
    return;
  }
  if (classRows.length === 0) return;

  const freeSlots = [];
  classRows.forEach((row, rowIdx) => {
    DAYS.forEach((day, dayIdx) => {
      const key = slotKey(row.id, day.key);
      if (!cls.schedule[key]) freeSlots.push({ rowId: row.id, dayKey: day.key, dayIdx, rowIdx });
    });
  });

  if (freeSlots.length === 0) {
    toast("A grade já está totalmente preenchida.");
    return;
  }

  const quotas = SUBJECT_QUOTAS[cls.classType] || {};
  const currentUsage = subjectUsageCounts();
  const items = [];

  if (Object.keys(quotas).length > 0) {
    const bySubject = {};
    teachersInClass.forEach(t => {
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
      if (providers.length === 0) continue;
      let pi = 0;
      while (need > 0) {
        const p = providers[pi % providers.length];
        items.push({ teacherId: p.teacherId, subject: p.rawSubject, count: 1 });
        need--; pi++;
      }
    }
  } else {
    const totalUnits = freeSlots.length;
    const pool = [];
    teachersInClass.forEach(t => {
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

  const teacherDayCount = {};
  const subjectDayCount = {};
  Object.entries(cls.schedule).forEach(([k, entry]) => {
    const [, dayKey] = k.split("|");
    teacherDayCount[`${entry.teacherId}|${dayKey}`] = (teacherDayCount[`${entry.teacherId}|${dayKey}`] || 0) + 1;
    subjectDayCount[`${entry.teacherId}|${entry.subject}|${dayKey}`] = (subjectDayCount[`${entry.teacherId}|${entry.subject}|${dayKey}`] || 0) + 1;
  });

  // Pré-computa slots ocupados por cada professor em outras turmas (por dia+label).
  // Como cada turma tem sua própria lista, identificamos o "mesmo professor"
  // entre turmas pelo NOME (uppercase).
  const otherClassBusy = new Set(); // "TEACHER_NAME|dayKey|Turno|Aula"
  for (const other of state.classes) {
    if (other.id === cls.id) continue;
    for (const k of Object.keys(other.schedule)) {
      const e = other.schedule[k];
      const nameUp = teacherNameById(other, e.teacherId);
      if (!nameUp) continue;
      const [rowId, dayKey] = k.split("|");
      const label = slotTimeLabel(other.classType, rowId);
      otherClassBusy.add(`${nameUp}|${dayKey}|${label}`);
    }
  }

  shuffle(freeSlots);
  const units = items.map(it => ({ teacherId: it.teacherId, subject: it.subject }));
  shuffle(units);

  const newSchedule = { ...cls.schedule };

  function scoreSlot(unit, slot) {
    const td = teacherDayCount[`${unit.teacherId}|${slot.dayKey}`] || 0;
    const sd = subjectDayCount[`${unit.teacherId}|${unit.subject}|${slot.dayKey}`] || 0;
    return sd * 100 + td * 10;
  }

  const usedSlotKeys = new Set();
  let skippedByCrossClass = 0;
  for (const unit of units) {
    const unitTeacher = teachersInClass.find(t => t.id === unit.teacherId);
    const unitNameUp = unitTeacher ? (unitTeacher.name || "").toUpperCase() : null;
    let best = null;
    let bestScore = Infinity;
    for (const slot of freeSlots) {
      const sk = slotKey(slot.rowId, slot.dayKey);
      if (usedSlotKeys.has(sk)) continue;
      // Bloqueia se o professor (identificado por NOME) já está em outra turma no mesmo dia+horário
      const label = slotTimeLabel(cls.classType, slot.rowId);
      if (unitNameUp && otherClassBusy.has(`${unitNameUp}|${slot.dayKey}|${label}`)) continue;
      const sc = scoreSlot(unit, slot);
      if (sc < bestScore) { bestScore = sc; best = slot; if (sc === 0) break; }
    }
    if (!best) { skippedByCrossClass++; continue; }
    const sk = slotKey(best.rowId, best.dayKey);
    newSchedule[sk] = { teacherId: unit.teacherId, subject: unit.subject };
    usedSlotKeys.add(sk);
    teacherDayCount[`${unit.teacherId}|${best.dayKey}`] = (teacherDayCount[`${unit.teacherId}|${best.dayKey}`] || 0) + 1;
    subjectDayCount[`${unit.teacherId}|${unit.subject}|${best.dayKey}`] = (subjectDayCount[`${unit.teacherId}|${unit.subject}|${best.dayKey}`] || 0) + 1;
    // Reserva no busy para evitar duplicar em passos seguintes desta mesma unidade
    if (unitNameUp) {
      const label = slotTimeLabel(cls.classType, best.rowId);
      otherClassBusy.add(`${unitNameUp}|${best.dayKey}|${label}`);
    }
  }

  cls.schedule = newSchedule;
  save();
  renderGrid();
  renderTeachers();
  if (skippedByCrossClass > 0) {
    toast(`Preenchimento concluído. ${skippedByCrossClass} aula(s) não alocadas por choque entre turmas.`, "success");
  } else {
    toast("Preenchimento automático concluído. Faça os ajustes que quiser.", "success");
  }
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
  $("#btnAddClass").addEventListener("click", () => {
    const name = $("#newClassName").value.trim();
    const type = $("#newClassType").value;
    addClass(name, type);
    $("#newClassName").value = "";
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
  $("#btnAutoFill").addEventListener("click", () => { autoFill(); });
  $("#btnClearGrid").addEventListener("click", async () => {
    const cls = activeClass();
    if (!cls) { toast("Nenhuma turma selecionada.", "error"); return; }
    const ok = await confirmModal(`Limpar todos os horários da turma "${cls.name}"?`);
    if (!ok) return;
    cls.schedule = {}; save(); renderGrid(); renderTeachers();
    toast("Grade limpa.");
  });
  $("#btnExportPdf").addEventListener("click", exportPDF);
}

function seedIfEmpty() {
  if (state.classes.length === 0) {
    const cid = uid();
    state.classes = [{
      id: cid,
      name: "4° A",
      classType: "regular",
      schedule: {},
      teachers: [
        { id: uid(), name: "MARIANA", color: "#c6e0f5",
          subjects: ["POR","MAT","CIÊN"],
          subjectQuotas: { "POR": 6, "MAT": 5, "CIÊN": 2 } },
        { id: uid(), name: "JOÃO", color: "#f8cbad",
          subjects: ["HIST","GEO","ED FÍS","CID","ART"],
          subjectQuotas: { "HIST": 2, "GEO": 2, "ED FÍS": 1, "CID": 1, "ART": 1 } },
      ],
    }];
    state.activeClassId = cid;
    save();
  } else if (state.classes.length > 0 && !state.activeClassId) {
    state.activeClassId = state.classes[0].id;
    save();
  }
}

function init() {
  load();
  seedIfEmpty();
  bindUI();
  resetSubjectsBuilder();
  renderClasses();
  renderTeachers();
  renderGrid();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
