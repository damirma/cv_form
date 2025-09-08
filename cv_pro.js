// cv_pro.js — versión afinada (impresión nativa, validación robusta, autosave y mejoras UX)
(() => {
  "use strict";

  /* ========== Helpers ========== */
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  const debounce = (fn, wait = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const fmtDT = ts => new Date(ts).toLocaleString("es-CO", { dateStyle:"medium", timeStyle:"short" });
  const fmtYM = d => !d ? "" : new Date(d).toLocaleDateString("es-CO", { year:"numeric", month:"short" });
  const rango = (ini, fin, actual) => (!ini && !fin) ? "" : (actual ? `${fmtYM(ini)} – Actual` : `${fmtYM(ini)}${fin ? " – " + fmtYM(fin) : ""}`);
  const blobDownload = (text, name, type="application/json") => {
    const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  };
  const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const validURL = v => { if (!v) return true; try { new URL(v); return true; } catch { return false; } };

  /* ========== DOM ========== */
  const form = $("#cvForm"), preview = $("#cvPreview");
  const expList = $("#experienciaList"), eduList = $("#educacionList");
  const tplExp = $("#tpl-experiencia"), tplEdu = $("#tpl-educacion");
  const btnAddExp = $("#btnAddExp"), btnAddEdu = $("#btnAddEdu");
  const foto = $("#foto"), fotoPreview = $("#fotoPreview"), btnQuitarFoto = $("#btnQuitarFoto");
  const tagsBox = $("#tags"), tagsInput = $("#habilidades");
  const btnTheme = $("#btnTheme"), btnDemo = $("#btnDemo"), btnLimpiar = $("#btnLimpiar");
  const btnGuardar = $("#btnGuardar"), btnExport = $("#btnExport"), btnPDF = $("#btnPDF"); // mismo id, ahora imprime
  const fileImport = $("#fileImport");
  const histList = $("#historyList"), histEmpty = $("#historyEmpty"), histSearch = $("#histSearch");
  const btnClearHist = $("#btnClearHist"), btnBackup = $("#btnBackup"), fileImportHist = $("#fileImportHist");
  const errorsBox = $("#formErrors"), toastBox = $("#formToast");
  const progressBar = $("#progressBar"), progressPct = $("#progressPct");

  /* ========== State & Storage ========== */
  const KEY_CURR = "cv.pro.v2.current";
  const KEY_HIST = "cv.pro.v2.history";
  const KEY_THEME = "cv.pro.v2.theme";

  const emptyState = () => ({
    fotoDataUrl: null, nombre: "", titulo: "", email: "", telefono: "", ubicacion: "",
    linkedin: "", github: "", sitio: "", resumen: "", habilidades: [], experiencia: [], educacion: []
  });

  let state = emptyState();

  const safeParse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
  const loadState = () => safeParse(localStorage.getItem(KEY_CURR), null) || null;
  const saveState = (st) => { try { localStorage.setItem(KEY_CURR, JSON.stringify(st)); } catch { /* quota */ } };
  const loadHist  = () => safeParse(localStorage.getItem(KEY_HIST), []) || [];
  const saveHist  = (arr) => { try { localStorage.setItem(KEY_HIST, JSON.stringify(arr)); } catch { /* quota */ } };

  /* ========== Toast & Progress ========== */
  function toast(msg, type="ok") {
    toastBox.textContent = msg;
    toastBox.className = "toast show " + (type === "err" ? "err" : "ok");
    setTimeout(() => toastBox.classList.remove("show"), 1800);
  }
  function updateProgress() {
    const d = serialize();
    let total = 8, score = 0;
    if (d.nombre) score++; if (d.email) score++; if (d.telefono) score++; if (d.ubicacion) score++;
    if (d.resumen) score++; if (d.experiencia.length) score++; if (d.educacion.length) score++;
    if (d.habilidades.length >= 3) score++;
    const pct = Math.round((score / total) * 100);
    progressBar.style.width = pct + "%"; progressPct.textContent = pct + "%";
  }

  /* ========== Items (Experiencia / Educación) ========== */
  function addExp(data = {}) {
    const n = tplExp.content.firstElementChild.cloneNode(true);
    bindItem(n, "exp");
    n.querySelector('[name="empresa"]').value = data.empresa || "";
    n.querySelector('[name="cargo"]').value   = data.cargo   || "";
    n.querySelector('[name="ubi"]').value     = data.ubi     || "";
    n.querySelector('[name="ini"]').value     = data.ini     || "";
    n.querySelector('[name="fin"]').value     = data.fin     || "";
    n.querySelector('[name="actual"]').checked = !!data.actual;
    n.querySelector('textarea[name="logros"]').value = (data.logros || []).join("\n");
    expList.appendChild(n);
  }
  function addEdu(data = {}) {
    const n = tplEdu.content.firstElementChild.cloneNode(true);
    bindItem(n, "edu");
    n.querySelector('[name="inst"]').value = data.inst || "";
    n.querySelector('[name="tit"]').value  = data.tit  || "";
    n.querySelector('[name="ini"]').value  = data.ini  || "";
    n.querySelector('[name="fin"]').value  = data.fin  || "";
    n.querySelector('textarea[name="det"]').value = data.det || "";
    eduList.appendChild(n);
  }
  function bindItem(node, kind) {
    on(node.querySelector('[data-act="del"]'), "click", () => { node.remove(); updateProgress(); saveLiveState(); });
    on(node.querySelector('[data-act="dup"]'), "click", () => {
      const clone = node.cloneNode(true); bindItem(clone, kind); node.after(clone); updateProgress(); saveLiveState();
    });
    if (kind === "exp") {
      const fin = node.querySelector('[name="fin"]');
      const actual = node.querySelector('[name="actual"]');
      const sync = () => { fin.disabled = actual.checked; if (actual.checked) fin.value = ""; };
      on(actual, "change", sync); sync();
    }
  }

  /* ========== Serializar / Poblar ========== */
  function serialize() {
    const d = {
      fotoDataUrl: fotoPreview.src && !fotoPreview.hidden ? fotoPreview.src : null,
      nombre: $("#nombre").value.trim(), titulo: $("#titulo").value.trim(),
      email: $("#email").value.trim(), telefono: $("#telefono").value.trim(),
      ubicacion: $("#ubicacion").value.trim(),
      linkedin: $("#linkedin").value.trim(), github: $("#github").value.trim(), sitio: $("#sitio").value.trim(),
      resumen: $("#resumen").value.trim(),
      habilidades: collectTags(),
      experiencia: [], educacion: []
    };
    $$(".exp", expList).forEach(it => {
      const empresa = it.querySelector('[name="empresa"]').value.trim();
      const cargo   = it.querySelector('[name="cargo"]').value.trim();
      const ubi     = it.querySelector('[name="ubi"]').value.trim();
      const ini     = it.querySelector('[name="ini"]').value;
      const fin     = it.querySelector('[name="fin"]').value;
      const actual  = it.querySelector('[name="actual"]').checked;
      const logros  = it.querySelector('textarea[name="logros"]').value.split("\n").map(s => s.replace(/^[-•]\s*/, "").trim()).filter(Boolean);
      if (empresa || cargo || ini || fin || logros.length) d.experiencia.push({ empresa, cargo, ubi, ini: ini || null, fin: fin || null, actual, logros });
    });
    $$(".edu", eduList).forEach(it => {
      const inst = it.querySelector('[name="inst"]').value.trim();
      const tit  = it.querySelector('[name="tit"]').value.trim();
      const ini  = it.querySelector('[name="ini"]').value;
      const fin  = it.querySelector('[name="fin"]').value;
      const det  = it.querySelector('textarea[name="det"]').value.trim();
      if (inst || tit || ini || fin || det) d.educacion.push({ inst, tit, ini: ini || null, fin: fin || null, det });
    });
    return d;
  }
  function populate(d) {
    if (!d) return;
    $("#nombre").value = d.nombre || ""; $("#titulo").value = d.titulo || "";
    $("#email").value = d.email || "";   $("#telefono").value = d.telefono || "";
    $("#ubicacion").value = d.ubicacion || ""; $("#linkedin").value = d.linkedin || "";
    $("#github").value = d.github || "";     $("#sitio").value = d.sitio || "";
    $("#resumen").value = d.resumen || "";   setTags(d.habilidades || []);
    if (d.fotoDataUrl) { fotoPreview.src = d.fotoDataUrl; fotoPreview.hidden = false; btnQuitarFoto.hidden = false; }
    else { fotoPreview.hidden = true; btnQuitarFoto.hidden = true; fotoPreview.removeAttribute("src"); }
    expList.innerHTML = ""; eduList.innerHTML = "";
    (d.experiencia || []).forEach(addExp); (d.educacion || []).forEach(addEdu);
    if (!expList.children.length) addExp();
    if (!eduList.children.length) addEdu();
  }

  /* ========== Tags (habilidades) ========== */
  function setTags(arr) { tagsBox.innerHTML = ""; (arr || []).forEach(addTag); }
  function collectTags() { return $$(".tag", tagsBox).map(t => t.dataset.val); }
  function addTag(val) {
    val = (val || "").trim(); if (!val) return;
    if (collectTags().some(x => x.toLowerCase() === val.toLowerCase())) return;
    const el = document.createElement("span");
    el.className = "tag"; el.dataset.val = val;
    el.innerHTML = esc(val) + ' <span class="x" title="Quitar" aria-label="Quitar">×</span>';
    on(el.querySelector(".x"), "click", () => { el.remove(); updateProgress(); saveLiveState(); });
    tagsBox.appendChild(el);
  }
  on(tagsInput, "keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagsInput.value.replace(",", "")); tagsInput.value = ""; updateProgress(); saveLiveState(); }
  });

  /* ========== Validación ========== */
  function validateForm() {
    const d = serialize();
    const errs = [];
    $$("input, textarea", form).forEach(el => el.classList.remove("invalid"));
    if (!d.nombre) { $("#nombre").classList.add("invalid"); errs.push("El nombre es obligatorio."); }
    if (!d.email)  { $("#email").classList.add("invalid");  errs.push("El email es obligatorio."); }
    if (d.email && !validEmail(d.email)) { $("#email").classList.add("invalid"); errs.push("Formato de email inválido."); }
    [["#linkedin", d.linkedin, "LinkedIn"],["#github", d.github, "GitHub"],["#sitio", d.sitio, "Sitio/Portafolio"]]
      .forEach(([sel,val,lbl]) => { if (val && !validURL(val)) { $(sel).classList.add("invalid"); errs.push(`URL inválida en ${lbl}.`); }});
    if (errs.length) {
      errorsBox.innerHTML = "<ul>" + errs.map(e => `<li>${esc(e)}</li>`).join("") + "</ul>";
      errorsBox.classList.add("show"); return false;
    } else { errorsBox.classList.remove("show"); errorsBox.innerHTML = ""; return true; }
  }

  /* ========== Render (vista previa) ========== */
  const tagHTML = arr => (arr || []).map(h => `<span class="tag">${esc(h)}</span>`).join(" ");
  const logrosHTML = arr => (arr && arr.length) ? `<ul>${arr.map(li => `<li>${esc(li)}</li>`).join("")}</ul>` : "";

  function render(d) {
    const meta = [
      d.email && `📧 ${esc(d.email)}`, d.telefono && `📱 ${esc(d.telefono)}`, d.ubicacion && `📍 ${esc(d.ubicacion)}`,
      d.linkedin && `<a href="${esc(d.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>`,
      d.github && `<a href="${esc(d.github)}" target="_blank" rel="noopener">GitHub</a>`,
      d.sitio && `<a href="${esc(d.sitio)}" target="_blank" rel="noopener">Portafolio</a>`
    ].filter(Boolean).join(" · ");

    const expHTML = (d.experiencia || []).map(e => `
      <div class="blk">
        <div class="row-line">
          <div>${esc(e.cargo || "")} <span class="sub">• ${esc(e.empresa || "")}</span></div>
          <small>${esc(rango(e.ini, e.fin, e.actual))}</small>
        </div>
        ${e.ubi ? `<small>${esc(e.ubi)}</small>` : ""}
        ${logrosHTML(e.logros)}
      </div>`).join("");

    const eduHTML = (d.educacion || []).map(ed => `
      <div class="blk">
        <div class="row-line">
          <div>${esc(ed.tit || "")} <span class="sub">• ${esc(ed.inst || "")}</span></div>
          <small>${esc(rango(ed.ini, ed.fin, false))}</small>
        </div>
        ${ed.det ? `<small>${esc(ed.det)}</small>` : ""}
      </div>`).join("");

    const fotoHTML = d.fotoDataUrl ? `<img src="${esc(d.fotoDataUrl)}" alt="Foto">` : "";

    preview.innerHTML = `
      <article class="cv">
        <header>
          ${fotoHTML}
          <div>
            <h2>${esc(d.nombre || "Tu nombre")}</h2>
            <div class="meta">${esc(d.titulo || "Rol profesional")}${meta ? " · " + meta : ""}</div>
          </div>
        </header>
        <main>
          ${d.resumen ? `<section class="blk"><h3>Resumen</h3><p>${esc(d.resumen)}</p></section>` : ""}
          ${d.habilidades.length ? `<section class="blk"><h3>Habilidades</h3>${tagHTML(d.habilidades)}</section>` : ""}
          ${d.experiencia.length ? `<section class="blk"><h3>Experiencia</h3>${expHTML}</section>` : ""}
          ${d.educacion.length ? `<section class="blk"><h3>Educación</h3>${eduHTML}</section>` : ""}
        </main>
      </article>`;
  }

  /* ========== Histórico ========== */
  function buildFileName(d) {
    const safe = (d.nombre || "cv").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    return `${safe}_${stamp}.json`;
  }
  function pushHist(action, data, label) {
    const hist = loadHist();
    hist.unshift({ id: uid(), ts: Date.now(), action, label: label || data.nombre || "Sin nombre", title: data.titulo || "", data });
    if (hist.length > 100) hist.length = 100;
    saveHist(hist); renderHistory();
  }
  const renderHistory = debounce(() => {
    const q = (histSearch.value || "").toLowerCase();
    const hist = loadHist();
    histList.innerHTML = "";
    const items = hist.filter(h =>
      (h.label || "").toLowerCase().includes(q) ||
      (h.title || "").toLowerCase().includes(q)
    );
    if (!items.length) { histEmpty.style.display = "block"; return; }
    histEmpty.style.display = "none";
    items.forEach(h => {
      const li = document.createElement("li");
      li.innerHTML = `
        <div class="info">
          <span class="title">${esc(h.label || "Sin nombre")}${h.title ? ` — <span class="muted">${esc(h.title)}</span>` : ""}</span>
          <span class="when">${esc(fmtDT(h.ts))}</span>
        </div>
        <div class="actions">
          <span class="chip">${esc(h.action)}</span>
          <button class="btn tiny" data-act="load">Cargar</button>
          <button class="btn tiny" data-act="rename">Renombrar</button>
          <button class="btn tiny" data-act="export">Exportar</button>
          <button class="btn tiny danger" data-act="delete">Eliminar</button>
        </div>`;
      li.querySelector('[data-act="load"]').addEventListener("click", () => { populate(h.data); render(h.data); saveLiveState(); toast("Registro cargado"); });
      li.querySelector('[data-act="rename"]').addEventListener("click", () => {
        const nuevo = prompt("Nuevo nombre para el registro:", h.label || "");
        if (nuevo !== null) { const all = loadHist(); const item = all.find(x => x.id === h.id); if (item) { item.label = (nuevo.trim() || item.label); saveHist(all); renderHistory(); } }
      });
      li.querySelector('[data-act="export"]').addEventListener("click", () => blobDownload(JSON.stringify(h.data, null, 2), buildFileName(h.data), "application/json"));
      li.querySelector('[data-act="delete"]').addEventListener("click", () => {
        if (confirm("¿Eliminar este registro del histórico?")) { const all = loadHist().filter(x => x.id !== h.id); saveHist(all); renderHistory(); }
      });
      histList.appendChild(li);
    });
  }, 120);


  function applyTheme(t) {


  }

  const toggleTheme = () => setTheme((localStorage.getItem(KEY_THEME) || "dark") === "dark" ? "light" : "dark");

  /* ========== Autosave (input + change) ========== */
  const saveLiveState = debounce(() => { const d = serialize(); saveState(d); render(d); updateProgress(); }, 150);

  /* ========== Imprimir ========== */
  function printCV() {
    const d = serialize();
    if (!validateForm()) { toast("Corrige errores antes de imprimir.", "err"); return; }
    render(d); // asegurar vista previa al día
    setTimeout(() => window.print(), 0); // abrir diálogo de impresión
    pushHist("impreso", d);
  }

  /* ========== Importar JSON ========== */
  function importJSONFile(file, intoHist=false) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (intoHist) {
          if (!Array.isArray(obj)) throw new Error("Histórico inválido (se esperaba un array).");
          saveHist(obj); renderHistory(); toast("Histórico importado"); return;
        }
        if (!obj || typeof obj !== "object") throw new Error("Estructura inválida.");
        populate(obj); render(obj); saveLiveState(); pushHist("importado", obj, obj.nombre || "Importado"); toast("CV importado");
      } catch (err) { alert("JSON inválido: " + err.message); }
    };
    reader.readAsText(file);
  }

  /* ========== Foto ========== */
  function handleFotoFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { fotoPreview.src = reader.result; fotoPreview.hidden = false; btnQuitarFoto.hidden = false; saveLiveState(); };
    reader.readAsDataURL(file);
  }

  /* ========== Sortable (opcional, si está cargado) ========== */
  function initSortable() {
    if (!window.Sortable) return;
    new Sortable(expList, { handle: ".drag", animation:150, ghostClass:"dragging" });
    new Sortable(eduList, { handle: ".drag", animation:150, ghostClass:"dragging" });
  }

  /* ========== Init ========== */
  function init() {
    // tema
    applyTheme(localStorage.getItem(KEY_THEME) || "dark");
    on(btnTheme, "click", toggleTheme);

    // acciones principales
    on(btnDemo, "click", () => {
      const demo = {
        fotoDataUrl:null,
        nombre:"Erik Gil", titulo:"Desarrollador Web (PHP/JS)", email:"erik.gil@example.com",
        telefono:"+57 300 123 4567", ubicacion:"Bogotá, Colombia",
        linkedin:"https://www.linkedin.com/in/usuario", github:"https://github.com/usuario", sitio:"https://indumaqher.co",
        resumen:"Desarrollador web con enfoque en paneles admin, MySQL y UX simple. Código claro y mantenible.",
        habilidades:["JavaScript","PHP","MySQL","HTML","CSS","Git"],
        experiencia:[{empresa:"Indumaqher",cargo:"Full-Stack Dev",ubi:"Bogotá",ini:"2024-03-01",fin:null,actual:true,logros:["Panel admin oscuro","Script db_init.php","Mejoras de UX"]}],
        educacion:[{inst:"ETITC La Salle",tit:"Ingeniería de Sistemas (en curso)",ini:"2021-01-01",fin:null,det:"Énfasis en programación web."}]
      };
      populate(demo); render(demo); saveState(demo); pushHist("demo", demo, "Demo"); toast("Datos de ejemplo cargados");
    });
    on(btnLimpiar, "click", () => { localStorage.removeItem(KEY_CURR); state = emptyState(); populate(state); render(state); updateProgress(); toast("Formulario reiniciado"); });
    on(btnGuardar, "click", () => { if (!validateForm()) return; const d = serialize(); saveState(d); render(d); pushHist("guardado", d); toast("Guardado y agregado al histórico"); });
    on(btnExport, "click", () => { const d = serialize(); if (!validateForm()) return; blobDownload(JSON.stringify(d,null,2), buildFileName(d)); pushHist("exportado", d); toast("JSON exportado"); });

    // botón imprime (usa el mismo id del antiguo PDF)
    on(btnPDF, "click", printCV);

    // formulario (autosave & preview en vivo)
    on(form, "input", saveLiveState);
    on(form, "change", saveLiveState);

    // añadir bloques
    on(btnAddExp, "click", () => { addExp(); updateProgress(); saveLiveState(); expList.lastElementChild?.scrollIntoView({ behavior:"smooth", block:"center" }); });
    on(btnAddEdu, "click", () => { addEdu(); updateProgress(); saveLiveState(); eduList.lastElementChild?.scrollIntoView({ behavior:"smooth", block:"center" }); });

    // histórico
    on(histSearch, "input", renderHistory);
    on(btnClearHist, "click", () => { if (confirm("¿Vaciar por completo el histórico?")) { saveHist([]); renderHistory(); toast("Histórico vacío"); } });
    on(btnBackup, "click", () => { blobDownload(JSON.stringify(loadHist(),null,2), "cv_historico_backup.json"); toast("Histórico exportado"); });
    on(fileImportHist, "change", e => { const f = e.target.files[0]; if (f) importJSONFile(f, true); e.target.value = ""; });

    // import individual
    on(fileImport, "change", e => { [...e.target.files].forEach(f => importJSONFile(f, false)); e.target.value = ""; });

    // foto
    on(foto, "change", e => handleFotoFile(e.target.files[0]));
    on(btnQuitarFoto, "click", () => { fotoPreview.hidden = true; btnQuitarFoto.hidden = true; fotoPreview.removeAttribute("src"); saveLiveState(); });

    // atajos (mantenemos Ctrl/Cmd+P para ejecutar nuestra impresión con validación)
    on(window, "keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); btnGuardar.click(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") { e.preventDefault(); printCV(); }
    });

    // cargar estado o iniciar
    const saved = loadState();
    if (saved) { state = saved; populate(state); render(state); }
    else { addExp(); addEdu(); render(state); }

    // mejoras adicionales
    initSortable();
    updateProgress();
    renderHistory();
  }

  init();
})();
