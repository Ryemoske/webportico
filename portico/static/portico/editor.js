/* Editor de entrada del pórtico.
 * El estado (JSON del proyecto) vive en `estado`. Las tablas y formularios escriben en él;
 * cada cambio pide al servidor la interpretación (cargas, estabilidad, fases, avisos),
 * redibuja y guarda automáticamente.
 *
 * Relaciones por nombre (renombrar propaga, eliminar avisa):
 *   cargas_pano      ← paños de tipos_planta y de brochales
 *   cargas_lineales  ← tipos_planta.lineales[].carga
 *   cargas_puntuales ← tipos_planta.puntuales[].carga
 *   brochales        ← tipos_planta.brochales[].brochal
 *   tipos_planta     ← niveles.tipo_planta                                                */
(function () {
  "use strict";

  const COMPONENTES = ["PP", "CM", "SC"];
  const LADOS = { zpos: "z+", zneg: "z−" };
  const copia = (x) => JSON.parse(JSON.stringify(x));
  const CATALOGO = JSON.parse(document.getElementById("catalogo").textContent);
  const E_TACON = CATALOGO.excentricidad_tacon;
  const DIST_ROTULA = CATALOGO.distancia_rotula_tipica;
  const CANTOS = Object.keys(CATALOGO.cantos);
  const DESFASE_CM = 3; // de momento fijo (en gris)

  // ---------------- estado (ya migrado por el servidor) ----------------
  const estado = JSON.parse(document.getElementById("datos-proyecto").textContent) || {};
  estado.generales = estado.generales || { ingeniero: "" };
  estado.cargas_pano = estado.cargas_pano || [];
  estado.cargas_lineales = estado.cargas_lineales || [];
  estado.cargas_puntuales = estado.cargas_puntuales || [];
  estado.brochales = estado.brochales || [];
  estado.pilares = estado.pilares || {};
  estado.pilares.lista = estado.pilares.lista || [];
  estado.tipos_planta = estado.tipos_planta || [];
  estado.niveles = estado.niveles || [];

  const panoPorDefecto = (modo = "completo") => ({ modo, longitud_placa: null, carga: nombres(estado.cargas_pano)[0] || null, tramos: [] });
  function normalizarTipo(tp) {
    tp.canto = tp.canto || CANTOS[0];
    tp.voladizos = tp.voladizos || {};
    ["inicio", "fin"].forEach((e) => { tp.voladizos[e] = tp.voladizos[e] || { activo: false, longitud: null }; });
    tp.panos = tp.panos || {};
    ["zpos", "zneg"].forEach((l) => { tp.panos[l] = tp.panos[l] || panoPorDefecto(); tp.panos[l].tramos = tp.panos[l].tramos || []; });
    ["rotulas_tipicas", "rotulas_mano", "lineales", "puntuales", "brochales"].forEach((k) => { tp[k] = tp[k] || []; });
    return tp;
  }
  estado.tipos_planta.forEach(normalizarTipo);

  let tipoActual = estado.tipos_planta.length ? estado.tipos_planta[0].nombre : null;
  let pestanaActiva = "generales";
  let interpretacion = null;
  let nivelResaltado = null;

  // ---------------- utilidades ----------------
  function parseNum(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return v;
    const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : String(v); // el texto no válido se conserva para marcarlo
  }
  const fmt = (v, dec = 3) =>
    typeof v === "number" ? v.toLocaleString("es-ES", { maximumFractionDigits: dec }) : (v ?? "");
  const fmt2 = (v) => // sin «−0,00»: lo que redondea a cero se muestra como 0,00
    typeof v === "number" ? (Math.abs(v) < 0.005 ? 0 : v).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function nombres(lista) { return lista.map((f) => f.nombre).filter(Boolean); }
  function nombreLibre(lista, base) {
    const usados = new Set(lista.map((f) => f.nombre));
    if (!usados.has(base)) return base;
    for (let i = 2; ; i++) if (!usados.has(`${base} (${i})`)) return `${base} (${i})`;
  }
  const tipoPlanta = (nombre) => estado.tipos_planta.find((t) => t.nombre === nombre) || null;
  const colorCanto = (c) => (CATALOGO.cantos[c] || {}).color || null;
  const colorTipoPlanta = (nombre) => colorCanto((tipoPlanta(nombre) || {}).canto);
  const muestra = (color) => (color ? `<span class="muestra-color" style="background:${esc(color)}"></span>` : "");

  // posiciones de los pilares a partir de la pestaña Pilares (para las rótulas típicas)
  function pilaresActuales() {
    const out = [];
    estado.pilares.lista.forEach((p, i) => {
      const s = parseNum(p.separacion);
      const x = i === 0 ? 0 : (out.length && typeof s === "number" ? out[out.length - 1].x + s : null);
      if (x !== null) out.push({ nombre: p.nombre || `P${i + 1}`, x, indice: i });
    });
    return out;
  }

  function formatoNumero(cell) {
    const v = cell.getValue();
    const el = cell.getElement();
    el.classList.toggle("celda-error", v !== null && v !== undefined && v !== "" && typeof v !== "number");
    return typeof v === "number" ? fmt(v) : esc(v ?? "");
  }
  const colNum = (title, field, extra = {}) =>
    Object.assign({ title, field, hozAlign: "right", editor: "input", mutator: (v) => parseNum(v), formatter: formatoNumero }, extra);
  const formatoNombre = (cell) => {
    const v = cell.getValue();
    cell.getElement().classList.toggle("celda-error", !v || !String(v).trim());
    return esc(v ?? "");
  };
  // celda que referencia por nombre a otra lista (desplegable); en rojo si el nombre no existe
  const colReferencia = (title, field, lista, color) => ({
    title, field, widthGrow: 2,
    editor: "list", editorParams: () => ({ values: nombres(lista()) }),
    formatter: (cell) => {
      const v = cell.getValue();
      const valido = v && nombres(lista()).includes(v);
      cell.getElement().classList.toggle("celda-error", !valido);
      return (valido && color ? muestra(color(v)) : "") + esc(v || "— elegir —");
    },
  });

  // ---------------- tablas ----------------
  function crearTabla(sel, columns, data) {
    const t = new Tabulator(sel, {
      data: copia(data),
      columns,
      layout: "fitColumns",
      renderVertical: "basic", // tablas pequeñas: sin renderizado virtual, crecen con sus filas
      reactiveData: false,
      placeholder: "Sin filas",
      selectableRange: 1,
      selectableRangeColumns: true,
      selectableRangeRows: true,
      selectableRangeClearCells: true,
      editTriggerEvent: "dblclick",
      clipboard: true,
      clipboardCopyStyled: false,
      clipboardCopyConfig: { rowHeaders: false, columnHeaders: false },
      clipboardCopyRowRange: "range",
      clipboardPasteParser: "range",
      clipboardPasteAction: "range",
      rowHeader: { resizable: false, frozen: true, width: 40, minWidth: 40, hozAlign: "center", formatter: "rownum", headerSort: false },
      columnDefaults: { headerSort: false, resizable: false, headerWordWrap: true, minWidth: 70 },
    });
    t.listo = new Promise((res) => t.on("tableBuilt", res));
    return t;
  }
  const tablas = {};
  const refrescar = (...nombresTabla) =>
    nombresTabla.forEach((n) => tablas[n] && tablas[n].getRows().forEach((r) => r.reformat()));
  function filasSeleccionadas(t) {
    const filas = new Set();
    (t.getRanges ? t.getRanges() : []).forEach((r) => r.getRows().forEach((f) => filas.add(f)));
    return [...filas];
  }
  // renombrar un elemento de una biblioteca: cambia también sus referencias
  function alRenombrar(tabla, aplicar) {
    tabla.on("cellEdited", (cell) => {
      if (cell.getField() !== "nombre") return;
      const antes = cell.getOldValue(), ahora = cell.getValue();
      if (!antes || antes === ahora) return;
      aplicar(antes, ahora);
      cargarTipo(tipoActual);
      cargarBrochal(brochalActual);
    });
  }

  // ---- 2 · cargas (biblioteca) ----
  const colDesfase = {
    title: "Desfase CM (plantas)", field: "desfase_CM", hozAlign: "right", cssClass: "calculada",
    formatter: (cell) => fmt(cell.getValue() ?? DESFASE_CM),
  };
  const colUso = (usos) => ({
    title: "Usado en", field: "_uso", cssClass: "calculada", widthGrow: 2,
    formatter: (cell) => {
      const usan = usos(cell.getRow().getData().nombre);
      return usan.length ? esc(usan.join(", ")) : "—";
    },
  });
  // PP: casilla (apagada por defecto) que habilita la celda del valor; apagada, el PP es 0 y va en gris
  const colCasillaPP = {
    title: "PP", field: "pp_activo", width: 52, minWidth: 52, hozAlign: "center", cssClass: "celda-casilla",
    formatter: (cell) => `<input type="checkbox" tabindex="-1" aria-label="Activar PP"${cell.getValue() ? " checked" : ""}>`,
  };
  const colValorPP = (unidad) => colNum(`PP (${unidad})`, "PP", {
    editable: (cell) => !!cell.getRow().getData().pp_activo,
    formatter: (cell) => {
      const activo = !!cell.getRow().getData().pp_activo;
      cell.getElement().classList.toggle("desactivada", !activo);
      return activo ? formatoNumero(cell) : "0";
    },
  });
  function alternarPP(tabla, cell) {
    const fila = cell.getRow();
    const activo = !fila.getData().pp_activo;
    fila.update(activo ? { pp_activo: true } : { pp_activo: false, PP: 0 }).then(() => { fila.reformat(); tabla.leer(); cambio(); });
  }

  const panosDe = (tp) => Object.values(tp.panos || {});
  const usosCargaPano = (n) => [
    ...estado.tipos_planta.filter((t) => panosDe(t).some((p) => p && p.modo !== "sin" && p.carga === n)).map((t) => t.nombre),
    ...estado.brochales.filter((b) => Object.values(b.panos || {}).some((p) => p && p.modo !== "sin" && p.carga === n)).map((b) => `brochal ${b.nombre}`),
  ];
  const usosEn = (campo) => (n) => estado.tipos_planta.filter((t) => (t[campo] || []).some((c) => c.carga === n || c.brochal === n)).map((t) => t.nombre);

  tablas.cargasPano = crearTabla(
    "#tabla-cargas-pano",
    [
      { title: "Nombre", field: "nombre", editor: "input", widthGrow: 2, formatter: formatoNombre },
      colNum("CM (kN/m²)", "CM"), colNum("SC (kN/m²)", "SC"), colDesfase, colUso(usosCargaPano),
    ],
    estado.cargas_pano
  );
  tablas.cargasPano.leer = () => {
    estado.cargas_pano = tablas.cargasPano.getData().map(({ nombre, CM, SC, desfase_CM }) => ({ nombre, CM, SC, desfase_CM }));
    Object.values(editoresPano).forEach((e) => e.pintar()); // desplegables de carga de los paños
  };
  tablas.cargasPano.filaNueva = () => ({ nombre: nombreLibre(estado.cargas_pano, "Vivienda"), CM: 2, SC: 2, desfase_CM: DESFASE_CM });
  alRenombrar(tablas.cargasPano, (antes, ahora) => {
    const cambiar = (p) => { if (p && p.carga === antes) p.carga = ahora; };
    estado.tipos_planta.forEach((t) => panosDe(t).forEach(cambiar));
    estado.brochales.forEach((b) => Object.values(b.panos || {}).forEach(cambiar));
  });

  for (const [clave, campo, sel, unidad, base, campoTipo] of [
    ["cargasLineales", "cargas_lineales", "#tabla-cargas-lineales", "kN/m", "Fachada", "lineales"],
    ["cargasPuntuales", "cargas_puntuales", "#tabla-cargas-puntuales", "kN", "Carga especial", "puntuales"],
  ]) {
    const t = crearTabla(
      sel,
      [
        { title: "Nombre", field: "nombre", editor: "input", widthGrow: 2, formatter: formatoNombre },
        colCasillaPP, colValorPP(unidad), colNum(`CM (${unidad})`, "CM"), colNum(`SC (${unidad})`, "SC"),
        colDesfase, colUso(usosEn(campoTipo)),
      ],
      estado[campo]
    );
    t.leer = () => {
      estado[campo] = t.getData().map(({ nombre, pp_activo, PP, CM, SC, desfase_CM }) =>
        ({ nombre, pp_activo: !!pp_activo, PP: pp_activo ? PP : 0, CM, SC, desfase_CM }));
      refrescar(campoTipo === "lineales" ? "tpLineales" : "tpPuntuales");
    };
    t.filaNueva = () => ({ nombre: nombreLibre(estado[campo], base), pp_activo: false, PP: 0, CM: null, SC: null, desfase_CM: DESFASE_CM });
    t.on("cellClick", (e, cell) => { if (cell.getField() === "pp_activo") alternarPP(t, cell); });
    alRenombrar(t, (antes, ahora) => estado.tipos_planta.forEach((tp) => tp[campoTipo].forEach((c) => { if (c.carga === antes) c.carga = ahora; })));
    t.usos = usosEn(campoTipo);
    tablas[clave] = t;
  }

  // ---- 4 · pilares: una fila por pilar; el primero está en x = 0 ----
  const SECCION_PILAR = "30×30"; // de momento fija (en gris): la calculará el programa
  const posicionFila = (cell) => cell.getTable().getRows().indexOf(cell.getRow());
  tablas.pilares = crearTabla(
    "#tabla-pilares",
    [
      { title: "Pilar", field: "nombre", editor: "input", formatter: formatoNombre },
      colNum("Separación al anterior (m)", "separacion", {
        editable: (cell) => posicionFila(cell) > 0,
        formatter: (cell) => {
          const primero = posicionFila(cell) === 0;
          cell.getElement().classList.toggle("desactivada", primero);
          return primero ? "—" : formatoNumero(cell);
        },
      }),
      {
        title: "x (m)", field: "_x", hozAlign: "right", cssClass: "calculada",
        formatter: (cell) => {
          let x = 0;
          const filas = cell.getTable().getRows();
          for (let i = 1; i <= filas.indexOf(cell.getRow()); i++) {
            const s = filas[i].getData().separacion;
            if (typeof s !== "number") return "?";
            x += s;
          }
          return fmt2(x);
        },
      },
      { title: "Sección", field: "_seccion", hozAlign: "center", cssClass: "calculada", formatter: () => SECCION_PILAR },
    ],
    estado.pilares.lista
  );
  tablas.pilares.leer = () => {
    estado.pilares.lista = tablas.pilares.getData().map(({ nombre, separacion }, i) => ({ nombre, separacion: i === 0 ? null : separacion }));
    refrescar("pilares"); // recalcula x y el «—» del primero
    pintarRotulasTipicas();
  };
  tablas.pilares.filaNueva = () => {
    const d = tablas.pilares.getData();
    const usados = new Set(d.map((p) => p.nombre));
    let n = d.length + 1;
    while (usados.has(`P${n}`)) n++;
    const ult = d[d.length - 1];
    return { nombre: `P${n}`, separacion: d.length ? (ult && typeof ult.separacion === "number" ? ult.separacion : null) : null };
  };

  // ---- 5 · tipos de planta: tablas del tipo seleccionado ----
  // excentricidad y lado: con e = 0 la carga va en eje y el lado no cuenta (en gris)
  const colLado = {
    title: "Lado", field: "lado", hozAlign: "center",
    editor: "list", editorParams: { values: LADOS },
    editable: (cell) => (parseNum(cell.getRow().getData().e) || 0) > 0,
    formatter: (cell) => {
      const enEje = !((parseNum(cell.getRow().getData().e) || 0) > 0);
      cell.getElement().classList.toggle("desactivada", enEje);
      return enEje ? "en eje" : esc(LADOS[cell.getValue()] || "z+");
    },
  };
  const colExcentricidad = colNum("e (m)", "e");

  tablas.rotulasMano = crearTabla("#tabla-rotulas-mano", [colNum("x (m)", "x")], []);
  tablas.tpLineales = crearTabla(
    "#tabla-tp-lineales",
    [colNum("x inicial (m)", "x0"), colNum("x final (m)", "xf"), colReferencia("Carga", "carga", () => estado.cargas_lineales), colExcentricidad, colLado],
    []
  );
  tablas.tpPuntuales = crearTabla(
    "#tabla-tp-puntuales",
    [colNum("x (m)", "x"), colReferencia("Carga", "carga", () => estado.cargas_puntuales), colExcentricidad, colLado],
    []
  );
  tablas.tpBrochales = crearTabla(
    "#tabla-tp-brochales",
    [
      colNum("x (m)", "x"),
      colReferencia("Brochal", "brochal", () => estado.brochales),
      { title: "Lado", field: "lado", hozAlign: "center", editor: "list", editorParams: { values: LADOS }, formatter: (cell) => esc(LADOS[cell.getValue()] || "z+") },
      { title: "e (m)", field: "_e", hozAlign: "right", cssClass: "calculada", formatter: () => fmt(E_TACON) },
    ],
    []
  );
  const ultimaFila = (t) => { const d = t.getData(); return d[d.length - 1]; };
  tablas.rotulasMano.filaNueva = () => ({ x: null });
  tablas.tpLineales.filaNueva = () => { const u = ultimaFila(tablas.tpLineales); return { x0: null, xf: null, carga: u ? u.carga : nombres(estado.cargas_lineales)[0] || null, e: u ? u.e : 0, lado: u ? u.lado : "zpos" }; };
  tablas.tpPuntuales.filaNueva = () => { const u = ultimaFila(tablas.tpPuntuales); return { x: null, carga: u ? u.carga : nombres(estado.cargas_puntuales)[0] || null, e: u ? u.e : 0, lado: u ? u.lado : "zpos" }; };
  tablas.tpBrochales.filaNueva = () => { const u = ultimaFila(tablas.tpBrochales); return { x: null, brochal: u ? u.brochal : nombres(estado.brochales)[0] || null, lado: u ? u.lado : "zpos" }; };
  const campos = { rotulasMano: ["rotulas_mano", ["x"]], tpLineales: ["lineales", ["x0", "xf", "carga", "e", "lado"]],
                   tpPuntuales: ["puntuales", ["x", "carga", "e", "lado"]], tpBrochales: ["brochales", ["x", "brochal", "lado"]] };
  for (const [clave, [campo, props]] of Object.entries(campos)) {
    tablas[clave].leer = () => {
      const tp = tipoPlanta(tipoActual);
      if (!tp) return;
      tp[campo] = tablas[clave].getData().map((f) => Object.fromEntries(props.map((p) => [p, f[p] ?? null])));
      refrescar(clave); // el lado se apaga/enciende según la excentricidad
      refrescar("cargasLineales", "cargasPuntuales");
    };
  }

  // ---- 6 · niveles ----
  tablas.niveles = crearTabla(
    "#tabla-niveles",
    [
      { title: "Nombre", field: "nombre", editor: "input", widthGrow: 2 },
      colNum("Altura (m)", "altura"),
      colReferencia("Tipo de planta", "tipo_planta", () => estado.tipos_planta, colorTipoPlanta),
      {
        title: "Canto", field: "_canto", cssClass: "calculada", hozAlign: "center",
        formatter: (cell) => {
          const c = (tipoPlanta(cell.getRow().getData().tipo_planta) || {}).canto;
          return c ? muestra(colorCanto(c)) + `${esc(c)} cm` : "—";
        },
      },
    ],
    estado.niveles
  );
  tablas.niveles.leer = () => {
    estado.niveles = tablas.niveles.getData().map(({ nombre, altura, tipo_planta }) => ({ nombre, altura, tipo_planta }));
    pintarUsoTipo();
  };
  tablas.niveles.filaNueva = () => {
    const ult = estado.niveles[estado.niveles.length - 1];
    return { nombre: `Planta ${estado.niveles.length + 1}`, altura: ult ? ult.altura : null, tipo_planta: ult ? ult.tipo_planta : tipoActual };
  };

  let cargandoTipo = false;
  for (const t of Object.values(tablas)) {
    t.on("dataChanged", () => {
      if (cargandoTipo) return;
      t.leer();
      cambio();
    });
  }
  tablas.niveles.on("cellClick", () => {
    const filas = filasSeleccionadas(tablas.niveles);
    nivelResaltado = filas.length ? tablas.niveles.getRows().indexOf(filas[0]) : null;
    dibujar();
  });

  // ---------------- editor de paño (reutilizable: brochales y tipos de planta) ----------------
  // Un paño es lo que apoya en el tacón a un lado: completo, parcial (con tramos) o sin placas,
  // con su longitud de placa (aportación = la mitad) y su carga de paño.
  function crearEditorPano(contenedor, etiqueta, alCambiar, eje = "x") {
    const id = contenedor.id;
    contenedor.innerHTML = `
      <fieldset class="pano-caja"><legend>Paño ${esc(etiqueta)}</legend>
        <div class="radios">
          <label><input type="radio" name="${id}-modo" value="completo"> Completo</label>
          <label><input type="radio" name="${id}-modo" value="parcial"> Parcial</label>
          <label><input type="radio" name="${id}-modo" value="sin"> Sin placas</label>
        </div>
        <div class="pano-datos formulario">
          <label>Longitud de placa (m)<input class="pano-lp" autocomplete="off"></label>
          <label>Aportación (m)<input class="pano-aport solo-lectura" readonly tabindex="-1"></label>
          <label>Carga<select class="pano-carga"></select></label>
        </div>
        <div class="pano-tramos">
          <div class="tabla"></div>
          <div class="botonera">
            <button type="button" class="pano-anadir">+ Añadir tramo</button>
            <button type="button" class="pano-borrar">Eliminar filas seleccionadas</button>
          </div>
        </div>
      </fieldset>`;
    const q = (s) => contenedor.querySelector(s);
    const radios = [...contenedor.querySelectorAll(`input[name="${id}-modo"]`)];
    const inLp = q(".pano-lp"), inAport = q(".pano-aport"), selCarga = q(".pano-carga");
    // los datos se guardan como xi / xf (coordenada a lo largo de la pieza); el título dice el eje
    const tabla = crearTabla(q(".pano-tramos .tabla"), [colNum(`${eje} inicial (m)`, "xi"), colNum(`${eje} final (m)`, "xf")], []);
    let pano = null, cargando = false;

    function pintar() {
      const modo = pano ? pano.modo : "sin";
      radios.forEach((r) => { r.checked = r.value === modo; r.disabled = !pano; });
      q(".pano-datos").hidden = modo === "sin";
      q(".pano-tramos").hidden = modo !== "parcial";
      if (pano) {
        if (document.activeElement !== inLp) inLp.value = typeof pano.longitud_placa === "number" ? fmt(pano.longitud_placa) : pano.longitud_placa ?? "";
        const lp = parseNum(pano.longitud_placa);
        inAport.value = typeof lp === "number" ? fmt(lp / 2) : "";
        inLp.classList.toggle("celda-error", typeof lp !== "number" || lp <= 0);
        const opciones = nombres(estado.cargas_pano);
        selCarga.innerHTML = opciones.map((c) => `<option value="${esc(c)}"${c === pano.carga ? " selected" : ""}>${esc(c)}</option>`).join("") +
          (!opciones.includes(pano.carga) ? `<option value="" selected>— elegir —</option>` : "");
        selCarga.classList.toggle("celda-error", !opciones.includes(pano.carga));
      }
      tabla.redraw(true);
    }
    radios.forEach((r) => r.addEventListener("change", () => {
      pano.modo = r.value;
      if (pano.modo === "parcial" && !pano.tramos.length) {
        pano.tramos = [{ xi: 0, xf: null }];
        cargar(pano);
      }
      pintar(); alCambiar();
    }));
    inLp.addEventListener("input", () => { pano.longitud_placa = parseNum(inLp.value); pintar(); alCambiar(); });
    selCarga.addEventListener("change", () => { pano.carga = selCarga.value || null; pintar(); alCambiar(); });
    tabla.on("dataChanged", () => {
      if (cargando || !pano) return;
      pano.tramos = tabla.getData().map(({ xi, xf }) => ({ xi, xf }));
      alCambiar();
    });
    q(".pano-anadir").addEventListener("click", () => {
      const d = tabla.getData(), ult = d[d.length - 1];
      tabla.addRow({ xi: ult ? ult.xf : 0, xf: null }).then(() => tabla.redraw(true));
    });
    q(".pano-borrar").addEventListener("click", () => {
      const filas = filasSeleccionadas(tabla);
      if (!filas.length) return alert("Selecciona primero alguna celda de los tramos a eliminar.");
      filas.forEach((f) => f.delete());
    });
    async function cargar(p) {
      pano = p;
      cargando = true;
      await tabla.setData(copia(p ? p.tramos || [] : []));
      cargando = false;
      pintar();
    }
    return { cargar, pintar, tabla };
  }
  const editoresPano = {
    brXpos: crearEditorPano(document.getElementById("br-pano-xpos"), "+x", () => cambio(), "z"),
    brXneg: crearEditorPano(document.getElementById("br-pano-xneg"), "−x", () => cambio(), "z"),
    tpZpos: crearEditorPano(document.getElementById("tp-pano-zpos"), "z+", () => { refrescar("cargasPano"); cambio(); }, "x"),
    tpZneg: crearEditorPano(document.getElementById("tp-pano-zneg"), "z−", () => { refrescar("cargasPano"); cambio(); }, "x"),
  };
  Object.entries(editoresPano).forEach(([k, e]) => (tablas[`tramos_${k}`] = e.tabla)); // tamaño al cambiar de pestaña

  // ---------------- 3 · brochales ----------------
  let brochalActual = estado.brochales.length ? estado.brochales[0].nombre : null;
  const brochal = (nombre) => estado.brochales.find((b) => b.nombre === nombre) || null;
  const selBrochal = document.getElementById("brochal-sel");
  const inLuz = document.getElementById("br-luz");
  const radiosCantoBr = [...document.querySelectorAll('input[name="br-canto"]')];

  // tabla de resultados: reacción sobre la viga (z = 0) como R con excentricidad Δx, por hipótesis
  function pintarResultadosBrochal() {
    const caja = document.getElementById("br-resultados");
    const b = interpretacion && brochalActual && interpretacion.brochales ? interpretacion.brochales[brochalActual] : null;
    if (!b) { caja.innerHTML = `<p class="vacio">Sin resultados: revisa los avisos.</p>`; return; }
    const r = b.reacciones;
    const fila = (titulo, campo, unidad, clase = "") =>
      `<tr class="${clase}"><td>${titulo}</td>${COMPONENTES.map((k) => `<td>${fmt2(r[k][campo])}${unidad}</td>`).join("")}</tr>`;
    caja.innerHTML = `<table class="resumen resultados-brochal">
      <thead><tr><th></th>${COMPONENTES.map((k) => `<th>${k}</th>`).join("")}</tr></thead>
      <tbody>
        ${fila("Placas paño +x", "xpos", " kN")}
        ${fila("Placas paño −x", "xneg", " kN")}
        ${fila("Peso propio del brochal", "peso", " kN")}
        ${fila("<b>R</b> (reacción)", "R", " kN", "total")}
        ${fila("<b>Δx</b> (excentricidad)", "dx", " m", "total")}
      </tbody></table>
      <p class="ayuda">PP forjado considerado: ${fmt(b.peso_placa)} kN/m²</p>`;
  }
  function pintarBrochal() {
    selBrochal.innerHTML = estado.brochales
      .map((b) => `<option value="${esc(b.nombre)}"${b.nombre === brochalActual ? " selected" : ""}>${esc(b.nombre)}</option>`)
      .join("") || `<option value="">— crea un brochal —</option>`;
    const b = brochal(brochalActual);
    document.getElementById("form-brochal").hidden = !b;
    if (!b) return;
    if (document.activeElement !== inLuz) inLuz.value = typeof b.luz === "number" ? fmt(b.luz) : b.luz ?? "";
    inLuz.classList.toggle("celda-error", typeof parseNum(b.luz) !== "number" || parseNum(b.luz) <= 0);
    radiosCantoBr.forEach((r) => (r.checked = r.value === String(b.canto)));
  }
  function cargarBrochal(nombre) {
    brochalActual = nombre;
    const b = brochal(nombre);
    if (b) {
      b.panos = b.panos || {};
      ["xpos", "xneg"].forEach((l) => { b.panos[l] = b.panos[l] || panoPorDefecto(); b.panos[l].tramos = b.panos[l].tramos || []; });
    }
    pintarBrochal();
    editoresPano.brXpos.cargar(b ? b.panos.xpos : null);
    editoresPano.brXneg.cargar(b ? b.panos.xneg : null);
    pintarResultadosBrochal();
    dibujar();
  }
  selBrochal.addEventListener("change", () => cargarBrochal(selBrochal.value));
  inLuz.addEventListener("input", () => { const b = brochal(brochalActual); if (!b) return; b.luz = parseNum(inLuz.value); pintarBrochal(); cambio(); });
  radiosCantoBr.forEach((r) => r.addEventListener("change", () => { const b = brochal(brochalActual); if (!b) return; b.canto = r.value; cambio(); }));

  function pedirNombre(msg, inicial, existe) {
    const n = (prompt(msg, inicial || "") || "").trim();
    if (!n) return null;
    if (existe(n)) { alert(`Ya existe «${n}».`); return null; }
    return n;
  }
  function accionBrochal(accion) {
    if (accion === "br-nuevo") {
      const n = pedirNombre("Nombre del nuevo brochal:", nombreLibre(estado.brochales, "B1"), brochal);
      if (!n) return;
      estado.brochales.push({ nombre: n, luz: null, canto: CANTOS[0], panos: { xpos: panoPorDefecto(), xneg: panoPorDefecto() } });
      cargarBrochal(n); cambio();
      return;
    }
    const b = brochal(brochalActual);
    if (!b) return alert("No hay ningún brochal seleccionado.");
    if (accion === "br-duplicar") {
      const n = pedirNombre(`Nombre de la copia de «${b.nombre}»:`, nombreLibre(estado.brochales, `${b.nombre} B`), brochal);
      if (!n) return;
      estado.brochales.push(Object.assign(copia(b), { nombre: n }));
      cargarBrochal(n); cambio();
    } else if (accion === "br-renombrar") {
      const n = pedirNombre(`Nuevo nombre para «${b.nombre}»:`, b.nombre, brochal);
      if (!n) return;
      estado.tipos_planta.forEach((tp) => tp.brochales.forEach((c) => { if (c.brochal === b.nombre) c.brochal = n; }));
      b.nombre = n;
      cargarBrochal(n); cargarTipo(tipoActual); cambio();
    } else if (accion === "br-eliminar") {
      const usan = usosEn("brochales")(b.nombre);
      if (!confirm(usan.length ? `«${b.nombre}» está insertado en: ${usan.join(", ")}.\nEsas inserciones quedarán en rojo. ¿Eliminar?` : `¿Eliminar el brochal «${b.nombre}»?`)) return;
      estado.brochales = estado.brochales.filter((x) => x !== b);
      cargarBrochal(estado.brochales.length ? estado.brochales[0].nombre : null); cargarTipo(tipoActual); cambio();
    }
  }

  // ---------------- 5 · tipos de planta: selector y formulario ----------------
  const selTipo = document.getElementById("tipo-planta-sel");
  const radiosCantoTp = [...document.querySelectorAll('input[name="tp-canto"]')];
  const vol = {
    inicio: { check: document.getElementById("tp-vol-inicio"), long: document.getElementById("tp-vol-inicio-l") },
    fin: { check: document.getElementById("tp-vol-fin"), long: document.getElementById("tp-vol-fin-l") },
  };

  function pintarSelectorTipo() {
    selTipo.innerHTML = estado.tipos_planta
      .map((t) => `<option value="${esc(t.nombre)}"${t.nombre === tipoActual ? " selected" : ""}>${esc(t.nombre)}</option>`)
      .join("") || `<option value="">— crea un tipo de planta —</option>`;
    pintarUsoTipo();
  }
  function pintarUsoTipo() {
    const usan = estado.niveles.filter((n) => n.tipo_planta === tipoActual).map((n) => n.nombre || "?");
    document.getElementById("uso-tipo-planta").textContent = !tipoActual
      ? "No hay tipos de planta: crea uno con «Nuevo»."
      : usan.length ? `Niveles con este tipo de planta: ${usan.join(", ")}` : "Ningún nivel usa este tipo de planta.";
  }
  function pintarFormularioTipo() {
    const tp = tipoPlanta(tipoActual);
    document.getElementById("form-tipo-planta").hidden = !tp;
    if (!tp) return;
    radiosCantoTp.forEach((r) => (r.checked = r.value === String(tp.canto)));
    for (const [extremo, el] of Object.entries(vol)) {
      const v = tp.voladizos[extremo];
      el.check.checked = !!v.activo;
      el.long.disabled = !v.activo;
      if (document.activeElement !== el.long) el.long.value = v.activo ? (typeof v.longitud === "number" ? fmt(v.longitud) : v.longitud ?? "") : "";
      const lv = parseNum(v.longitud);
      el.long.classList.toggle("celda-error", !!v.activo && !(typeof lv === "number" && lv > 0));
    }
    pintarRotulasTipicas();
    pintarEstabilidad();
  }

  // rótulas típicas: a 1,20 m de cada pilar, solo hacia dentro; casillas por pilar
  function pintarRotulasTipicas() {
    const caja = document.getElementById("tp-rotulas-tipicas");
    const tp = tipoPlanta(tipoActual);
    const pil = pilaresActuales();
    if (!tp || pil.length < 2) { caja.innerHTML = `<p class="vacio">Define al menos dos pilares.</p>`; return; }
    const marcada = new Set(tp.rotulas_tipicas);
    // casillas fuera y flechas dentro:  ☐ ←  → ☐ ; en los pilares extremos solo con voladizo en ese lado
    const casilla = (i, lado, x, activa) => {
      const marca = `<input type="checkbox" data-rotula="${i}:${lado}"${marcada.has(`${i}:${lado}`) ? " checked" : ""}${activa ? "" : " disabled"}>`;
      const titulo = activa ? `x = ${fmt2(x)} m` : "Vano extremo articulado: solo con voladizo en este lado";
      return `<label title="${titulo}"${activa ? "" : ' class="desactivada"'}>${lado === "izq" ? `${marca} ←` : `→ ${marca}`}</label>`;
    };
    const ult = pil.length - 1;
    caja.innerHTML = pil.map((p, k) => `
      <div class="rotula-pilar">
        <span class="nombre-pilar">${esc(p.nombre)}</span>
        <span class="casillas">${k > 0 ? casilla(p.indice, "izq", p.x - DIST_ROTULA, k < ult || !!tp.voladizos.fin.activo) : `<span class="hueco"></span>`}${k < ult ? casilla(p.indice, "der", p.x + DIST_ROTULA, k > 0 || !!tp.voladizos.inicio.activo) : `<span class="hueco"></span>`}</span>
      </div>`).join("");
  }
  document.getElementById("tp-rotulas-tipicas").addEventListener("change", (ev) => {
    const tp = tipoPlanta(tipoActual);
    const clave = ev.target.dataset.rotula;
    if (!tp || !clave) return;
    tp.rotulas_tipicas = tp.rotulas_tipicas.filter((r) => r !== clave);
    if (ev.target.checked) tp.rotulas_tipicas.push(clave);
    cambio();
  });

  // nota de estabilidad: azul hiperestática, verde isostática, rojo mecanismo
  function pintarEstabilidad() {
    const nota = document.getElementById("tp-estabilidad");
    const tp = interpretacion && tipoActual && interpretacion.tipos_planta ? interpretacion.tipos_planta[tipoActual] : null;
    const est = tp && tp.estabilidad;
    if (!est) { nota.className = "estabilidad"; nota.textContent = ""; return; }
    const textos = {
      isostatica: `Isostática · grado de hiperestaticidad 0 (${est.apoyos} apoyos, ${est.rotulas} rótulas)`,
      hiperestatica: `Hiperestática · grado de hiperestaticidad ${est.gh} (${est.apoyos} apoyos, ${est.rotulas} rótulas)`,
      mecanismo: `Mecanismo · ${est.mecanismos} grado(s) de libertad: revisa las rótulas (${est.apoyos} apoyos, ${est.rotulas} rótulas)`,
    };
    nota.className = `estabilidad ${est.estado}`;
    nota.textContent = textos[est.estado];
  }

  async function cargarTipo(nombre) {
    tipoActual = nombre;
    const tp = tipoPlanta(nombre);
    cargandoTipo = true;
    await Promise.all(Object.entries(campos).map(([clave, [campo]]) => tablas[clave].setData(copia(tp ? tp[campo] : []))));
    cargandoTipo = false;
    await editoresPano.tpZpos.cargar(tp ? tp.panos.zpos : null);
    await editoresPano.tpZneg.cargar(tp ? tp.panos.zneg : null);
    pintarSelectorTipo();
    pintarFormularioTipo();
    dibujar();
  }
  selTipo.addEventListener("change", () => cargarTipo(selTipo.value));
  radiosCantoTp.forEach((r) => r.addEventListener("change", () => {
    const tp = tipoPlanta(tipoActual); if (!tp) return;
    tp.canto = r.value; refrescar("niveles"); cambio();
  }));
  for (const [extremo, el] of Object.entries(vol)) {
    el.check.addEventListener("change", () => {
      const tp = tipoPlanta(tipoActual); if (!tp) return;
      tp.voladizos[extremo].activo = el.check.checked;
      if (!el.check.checked) { // sin voladizo, el vano extremo es articulado: fuera su rótula típica
        el.long.blur();
        const pil = pilaresActuales();
        if (pil.length) {
          const clave = extremo === "inicio" ? `${pil[0].indice}:der` : `${pil[pil.length - 1].indice}:izq`;
          tp.rotulas_tipicas = tp.rotulas_tipicas.filter((r) => r !== clave);
        }
      }
      pintarFormularioTipo();
      if (el.check.checked) el.long.focus();
      cambio();
    });
    el.long.addEventListener("input", () => {
      const tp = tipoPlanta(tipoActual); if (!tp) return;
      tp.voladizos[extremo].longitud = parseNum(el.long.value);
      pintarFormularioTipo();
      cambio();
    });
  }

  function accionTipo(accion) {
    if (accion === "tp-nuevo") {
      const n = pedirNombre("Nombre del nuevo tipo de planta (p. ej. sótano, baja, tipo, cubierta):", "", tipoPlanta);
      if (!n) return;
      estado.tipos_planta.push(normalizarTipo({ nombre: n }));
      cargarTipo(n).then(cambio);
      return;
    }
    const tp = tipoPlanta(tipoActual);
    if (!tp) return alert("No hay ningún tipo de planta seleccionado.");
    if (accion === "tp-duplicar") {
      const n = pedirNombre(`Nombre de la copia de «${tp.nombre}»:`, nombreLibre(estado.tipos_planta, `${tp.nombre} B`), tipoPlanta);
      if (!n) return;
      estado.tipos_planta.push(Object.assign(copia(tp), { nombre: n }));
      cargarTipo(n).then(cambio);
    } else if (accion === "tp-renombrar") {
      const n = pedirNombre(`Nuevo nombre para «${tp.nombre}»:`, tp.nombre, tipoPlanta);
      if (!n) return;
      estado.niveles.forEach((nv) => { if (nv.tipo_planta === tp.nombre) nv.tipo_planta = n; });
      tp.nombre = n;
      tablas.niveles.setData(copia(estado.niveles));
      cargarTipo(n).then(cambio);
    } else if (accion === "tp-eliminar") {
      const usan = estado.niveles.filter((nv) => nv.tipo_planta === tp.nombre).map((nv) => nv.nombre);
      const msg = usan.length
        ? `«${tp.nombre}» lo usan estos niveles, que se quedarán sin tipo de planta:\n${usan.join(", ")}\n\n¿Eliminar?`
        : `¿Eliminar el tipo de planta «${tp.nombre}»?`;
      if (!confirm(msg)) return;
      estado.tipos_planta = estado.tipos_planta.filter((t) => t !== tp);
      refrescar("niveles", "cargasPano", "cargasLineales", "cargasPuntuales");
      cargarTipo(estado.tipos_planta.length ? estado.tipos_planta[0].nombre : null).then(cambio);
    }
  }

  // ---------------- botones ----------------
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-accion]");
    if (!b) return;
    const accion = b.dataset.accion;
    const t = tablas[b.dataset.tabla];

    if (accion === "anadir") {
      if (campos[b.dataset.tabla] && !tipoPlanta(tipoActual)) return alert("Crea primero un tipo de planta.");
      t.addRow(t.filaNueva()).then(() => t.redraw(true));
    } else if (accion === "borrar") {
      const filas = filasSeleccionadas(t);
      if (!filas.length) return alert("Selecciona primero alguna celda de las filas a eliminar.");
      const borrados = filas.map((f) => f.getData().nombre);
      const usos = t === tablas.cargasPano ? usosCargaPano : t.usos;
      const usan = usos ? [...new Set(borrados.flatMap(usos))] : [];
      if (usan.length && !confirm(`Lo que vas a eliminar se usa en: ${usan.join(", ")}.\nEsas referencias quedarán en rojo. ¿Eliminar?`)) return;
      filas.forEach((f) => f.delete());
    } else if (accion === "copiar-ultimo") {
      const d = tablas.niveles.getData();
      if (!d.length) return tablas.niveles.addRow(tablas.niveles.filaNueva());
      tablas.niveles.addRow(Object.assign({}, d[d.length - 1], { nombre: `Planta ${d.length + 1}` }));
    } else if (accion === "subir" || accion === "bajar") {
      moverNivel(accion === "subir" ? -1 : 1);
    } else if (accion.startsWith("br-")) {
      accionBrochal(accion);
    } else if (accion.startsWith("tp-")) {
      accionTipo(accion);
    }
  });

  function moverNivel(delta) {
    const t = tablas.niveles;
    const filas = filasSeleccionadas(t);
    if (!filas.length) return alert("Selecciona una celda del nivel a mover.");
    const i = t.getRows().indexOf(filas[0]);
    const d = t.getData();
    const j = i + delta;
    if (j < 0 || j >= d.length) return;
    [d[i], d[j]] = [d[j], d[i]];
    t.setData(d).then(() => { t.leer(); nivelResaltado = j; cambio(); });
  }

  // ---------------- 1 · datos generales ----------------
  const inputNombre = document.getElementById("nombre-proyecto");
  const tituloProyecto = document.getElementById("titulo-proyecto");
  inputNombre.addEventListener("input", () => {
    const n = inputNombre.value.trim();
    inputNombre.classList.toggle("celda-error", !n);
    tituloProyecto.textContent = n || "(sin nombre)";
    document.title = `${n || "(sin nombre)"} · SEI`;
    if (n) programarGuardado(); // un proyecto sin nombre no se guarda
  });
  const inputIngeniero = document.getElementById("ingeniero");
  inputIngeniero.value = estado.generales.ingeniero || "";
  inputIngeniero.addEventListener("input", () => { estado.generales.ingeniero = inputIngeniero.value; programarGuardado(); });
  const fechaLarga = (iso) => (iso ? new Date(iso).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" }) : "");
  function mostrarFechas(creado, modificado) {
    document.getElementById("fecha-creado").value = fechaLarga(creado);
    document.getElementById("fecha-modificado").value = fechaLarga(modificado);
  }
  mostrarFechas(document.getElementById("fecha-creado").dataset.iso, document.getElementById("fecha-modificado").dataset.iso);

  // ---------------- pestañas y acordeón ----------------
  document.querySelectorAll(".pestanas button").forEach((b) =>
    b.addEventListener("click", () => {
      pestanaActiva = b.dataset.tab;
      document.querySelectorAll(".pestanas button").forEach((x) => x.classList.toggle("activa", x === b));
      document.querySelectorAll(".pestana").forEach((p) => p.classList.toggle("activa", p.id === `tab-${b.dataset.tab}`));
      Object.values(tablas).forEach((t) => t.redraw(true)); // las creadas ocultas no tienen tamaño
      dibujar();
      pintarAvisosPestana();
    })
  );
  document.querySelectorAll("details.acordeon").forEach((d) =>
    d.addEventListener("toggle", () => { if (d.open) Object.values(tablas).forEach((t) => t.redraw(true)); })
  );

  // ---------------- guardar e interpretar ----------------
  const estadoGuardado = document.getElementById("estado-guardado");
  let tGuardar = null, tInterpretar = null, pendiente = false;
  function csrf() {
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  async function post(url, cuerpo) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() }, body: JSON.stringify(cuerpo) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  function cambio() {
    programarGuardado();
    clearTimeout(tInterpretar);
    tInterpretar = setTimeout(interpretarAhora, 250);
  }
  function programarGuardado() {
    pendiente = true;
    estadoGuardado.textContent = "Cambios sin guardar";
    estadoGuardado.className = "estado pendiente";
    clearTimeout(tGuardar);
    tGuardar = setTimeout(guardarAhora, 1200);
  }
  async function guardarAhora() {
    clearTimeout(tGuardar);
    estadoGuardado.textContent = "Guardando…";
    try {
      const r = await post(window.PORTICO.urlGuardar, { nombre: inputNombre.value, datos: estado });
      mostrarFechas(r.creado, r.modificado);
      pendiente = false;
      estadoGuardado.textContent = "Guardado";
      estadoGuardado.className = "estado";
    } catch (e) {
      estadoGuardado.textContent = "Error al guardar";
      estadoGuardado.className = "estado error";
    }
  }
  async function interpretarAhora() {
    try {
      interpretacion = await post(window.PORTICO.urlInterpretar, estado);
    } catch (e) {
      return;
    }
    pintarRevision();
    pintarResultadosBrochal();
    pintarEstabilidad();
    dibujar();
  }
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); guardarAhora(); }
  });
  window.addEventListener("beforeunload", (e) => { if (pendiente) { e.preventDefault(); e.returnValue = ""; } });

  // ---------------- 7 · revisión ----------------
  function pintarRevision() {
    const I = interpretacion;
    const av = I.avisos;
    const nErr = av.filter((a) => a.gravedad === "error").length;
    const nAv = av.filter((a) => a.gravedad === "aviso").length;
    const cont = document.getElementById("contador-avisos");
    cont.textContent = nErr + nAv ? String(nErr + nAv) : "";
    cont.className = "contador" + (nErr ? " error" : nAv ? " aviso" : "");
    document.getElementById("lista-avisos").innerHTML = av.length
      ? av.map((a) => `<li class="${a.gravedad}"><b>${esc(a.gravedad)}</b> ${esc(a.donde)}: ${esc(a.texto)}</li>`).join("")
      : `<li class="ok">Sin avisos.</li>`;
    pintarAvisosPestana();
    document.getElementById("tabla-fases").innerHTML =
      `<table class="resumen"><thead><tr><th>Fase</th><th>Estructura</th><th>Entra</th></tr></thead><tbody>` +
      I.fases.map((f) => `<tr><td>${esc(f.fase)}</td><td>${esc(f.estructura)}</td><td>${f.entra.map(esc).join(" · ") || "—"}</td></tr>`).join("") +
      `</tbody></table>`;

    const celdas = (v, mt, unidad = "") => COMPONENTES.map((k) => `<td>${fmt2(v[k])}${unidad}</td><td>${mt ? fmt2(mt[k]) : ""}</td>`).join("");
    const tramosTxt = (p) => p.tramos.map((t) => `${fmt2(t.xi)}–${fmt2(t.xf)}`).join(", ") || "—";
    document.getElementById("cargas-niveles").innerHTML = I.niveles.map((n) => {
      const filas = [];
      for (const [lado, s] of [["zpos", 1], ["zneg", -1]]) {
        const p = n.panos[lado];
        if (p.modo === "sin" || !p.tramos.length) continue;
        const mt = Object.fromEntries(COMPONENTES.map((k) => [k, s * E_TACON * p.q[k]]));
        filas.push(`<tr><td>Paño ${LADOS[lado]} · ${esc(p.carga ?? "—")} · placa ${fmt(p.longitud_placa)} m</td><td>${tramosTxt(p)}</td>${celdas(p.q, mt)}</tr>`);
      }
      if (n.peso_viga) filas.push(`<tr><td>Peso propio de la viga (canto ${esc(n.canto ?? "—")} cm)</td><td>${fmt2(n.x_min)}–${fmt2(n.x_max)}</td>${celdas({ PP: n.peso_viga, CM: 0, SC: 0 }, null)}</tr>`);
      n.lineales.forEach((c) => filas.push(`<tr><td>Lineal ${esc(c.carga)} · ${c.e ? `e ${fmt(c.e)} ${LADOS[c.lado]}` : "en eje"}</td><td>${fmt2(c.x0)}–${fmt2(c.xf)}</td>${celdas(c.w, c.mt)}</tr>`));
      n.puntuales.forEach((c) => filas.push(`<tr class="puntual"><td>Puntual ${esc(c.carga)} · ${c.e ? `e ${fmt(c.e)} ${LADOS[c.lado]}` : "en eje"}</td><td>x = ${fmt2(c.x)}</td>${celdas(c.P, c.mt, " kN")}</tr>`));
      n.brochales.forEach((c) => filas.push(`<tr class="puntual"><td>Brochal ${esc(c.brochal)} · ${LADOS[c.lado]}</td><td>x = ${fmt2(c.x)} → carga en ${fmt2(c.x_carga.PP)}</td>${celdas(c.R, c.mt, " kN")}</tr>`));
      const tot = `<tr class="total"><td>Total nivel</td><td></td>${COMPONENTES.map((k) => `<td>${fmt2(n.totales[k])} kN</td><td>${fmt2(n.torsor_total[k])}</td>`).join("")}</tr>`;
      const est = n.estabilidad ? ` · ${n.estabilidad.estado} (GH ${n.estabilidad.gh}${n.estabilidad.mecanismos ? `, ${n.estabilidad.mecanismos} mec.` : ""})` : "";
      return `<h4>${esc(n.nombre)} <span class="ud">tipo «${esc(n.tipo_planta ?? "—")}» · canto ${esc(n.canto ?? "—")} cm · rótulas: ${n.rotulas_x.map(fmt2).join("; ") || "ninguna"}${est}</span></h4>
        <table class="resumen"><thead><tr><th>Carga</th><th>x (m)</th>${COMPONENTES.map((k) => `<th>${k} q / P</th><th>mt ${k}</th>`).join("")}</tr></thead>
        <tbody>${filas.join("")}${tot}</tbody></table>`;
    }).join("") || `<p class="vacio">Sin niveles.</p>`;
    document.getElementById("json-interpretado").textContent = JSON.stringify(I, null, 2);
    document.getElementById("resumen-pilares").textContent = I.x_pilares.length > 1 ? `Longitud total: ${fmt2(I.longitud_total)} m` : "";
  }

  // ---------------- avisos bajo el dibujo: los de la pestaña activa ----------------
  // cada aviso dice dónde está («Tipos de planta · Tipo · …»); el comienzo indica la pestaña
  const PESTANAS_AVISO = [["Cargas", "cargas"], ["Brochales", "brochales"], ["Pilares", "pilares"],
                          ["Tipos de planta", "tipos-planta"], ["Niveles", "niveles"]];
  const pestanaDeAviso = (a) => (PESTANAS_AVISO.find(([p]) => a.donde === p || a.donde.startsWith(`${p} ·`)) || [null, null])[1];
  const nombrePestana = (id) => document.querySelector(`.pestanas button[data-tab="${id}"]`).textContent.replace(/^\d+ · /, "").replace(/\d+$/, "").trim();
  const ORDEN_GRAVEDAD = { error: 0, aviso: 1, info: 2 };

  function pintarAvisosPestana() {
    const caja = document.getElementById("resumen-avisos");
    if (!interpretacion) return;
    const todos = [...interpretacion.avisos].sort((a, b) => ORDEN_GRAVEDAD[a.gravedad] - ORDEN_GRAVEDAD[b.gravedad]);
    const global = pestanaActiva === "generales" || pestanaActiva === "revision";
    const propios = global ? todos : todos.filter((a) => pestanaDeAviso(a) === pestanaActiva);
    const quitarPestana = (donde) => (global ? donde : donde.replace(/^[^·]+· ?/, "") || "");
    const li = (a) => `<li class="${a.gravedad}"><b>${esc(a.gravedad)}</b> ${esc(quitarPestana(a.donde))}${quitarPestana(a.donde) ? ": " : ""}${esc(a.texto)}</li>`;
    const graves = propios.filter((a) => a.gravedad !== "info");
    const nErr = graves.filter((a) => a.gravedad === "error").length, nAv = graves.length - nErr;

    let html = graves.length
      ? `<p class="titulo-avisos">${nErr ? `<span class="error">${nErr} error(es)</span> ` : ""}${nAv ? `<span class="aviso">${nAv} aviso(s)</span>` : ""}${global ? "" : " en esta pestaña"}</p>`
      : `<p class="sin-errores">SIN ERRORES</p>`;
    if (propios.length) html += `<ul class="avisos">${propios.map(li).join("")}</ul>`;

    if (!global) { // problemas en otras pestañas: enlace para ir a cada una
      const otras = {};
      todos.filter((a) => a.gravedad !== "info" && pestanaDeAviso(a) !== pestanaActiva)
        .forEach((a) => { const p = pestanaDeAviso(a) || "revision"; otras[p] = (otras[p] || 0) + 1; });
      const enlaces = Object.entries(otras).map(([p, n]) => `<a href="#" data-ir-pestana="${p}">${esc(nombrePestana(p))} (${n})</a>`);
      if (enlaces.length) html += `<p class="otras-pestanas">También hay errores o avisos en: ${enlaces.join(" · ")}</p>`;
    }
    caja.innerHTML = html;
  }
  document.getElementById("resumen-avisos").addEventListener("click", (ev) => {
    const a = ev.target.closest("a[data-ir-pestana]");
    if (!a) return;
    ev.preventDefault();
    document.querySelector(`.pestanas button[data-tab="${a.dataset.irPestana}"]`).click();
  });

  // ---------------- dibujos ----------------
  const cont = document.getElementById("dibujo");
  new ResizeObserver(() => dibujar()).observe(cont);
  function ponerLeyenda(elementos) {
    document.getElementById("leyenda-dibujo").innerHTML =
      elementos.map(([clase, texto]) => `<span><i class="muestra ${clase}"></i>${esc(texto)}</span>`).join("");
  }
  const flecha = (x, y, largo, clase, titulo) =>
    `<g class="${clase}"><line x1="${x}" y1="${y - largo}" x2="${x}" y2="${y}"/><path d="M${x - 5},${y - 8} L${x},${y} L${x + 5},${y - 8}"/>${titulo ? `<title>${esc(titulo)}</title>` : ""}</g>`;

  function dibujar() {
    const I = interpretacion;
    if (!I) return;
    if (pestanaActiva === "brochales") return dibujarBrochal(I);
    if (pestanaActiva === "pilares") return dibujarPilares(I);
    if (pestanaActiva === "tipos-planta") return dibujarTipoPlanta(I);
    ponerLeyenda([["zpos", "placas z+"], ["zneg", "placas z−"], ["rotula", "rótula"]]);
    document.getElementById("titulo-dibujo").textContent = "Alzado del pórtico";
    cont.innerHTML = svgAlzado(I, I.niveles, { resaltar: true });
  }

  // ---- alzado de uno o varios niveles ----
  function svgAlzado(I, niveles, { resaltar = false, alturaFija = null } = {}) {
    const xs = I.x_pilares;
    const xMin = Math.min(xs[0], ...niveles.map((n) => n.x_min));
    const xMax = Math.max(xs[xs.length - 1], ...niveles.map((n) => n.x_max));
    const W = Math.max(cont.clientWidth, 320);
    const izq = 110, der = 24, abajo = 56;
    const sx = xMax > xMin ? (W - izq - der) / (xMax - xMin) : 1;
    const X = (x) => izq + (x - xMin) * sx;
    const hNivel = niveles.map((n) => alturaFija || Math.min(220, Math.max(130, n.altura * sx)));
    const arriba = (hNivel.length ? hNivel[hNivel.length - 1] * 0.45 : 0) + 40;
    const H = arriba + hNivel.reduce((a, b) => a + b, 0) + abajo;
    const maxLp = Math.max(1, ...niveles.flatMap((n) => [n.panos.zpos.longitud_placa, n.panos.zneg.longitud_placa]));

    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="alzado" role="img" aria-label="Alzado">`;
    let yBase = H - abajo;
    if (resaltar) niveles.forEach((n, i) => { // fondos: nivel seleccionado / niveles del tipo en edición
      const h = hNivel[i], yTop = yBase - h;
      if (i === nivelResaltado || (tipoActual && n.tipo_planta === tipoActual)) {
        s += `<rect x="${izq - 8}" y="${yTop}" width="${W - izq - der + 16}" height="${h}" class="${i === nivelResaltado ? "fondo-sel" : "fondo-grupo"}"/>`;
      }
      yBase = yTop;
    });

    yBase = H - abajo;
    niveles.forEach((n, i) => {
      const h = hNivel[i], yTop = yBase - h, hMax = h * 0.38;
      xs.forEach((x) => (s += `<line x1="${X(x)}" y1="${yBase}" x2="${X(x)}" y2="${yTop}" class="pilar"/>`));
      // placas: banda z− junto a la viga y z+ encima, altura proporcional a la longitud de placa
      const hn = (n.panos.zneg.longitud_placa / maxLp) * hMax / 2, hp = (n.panos.zpos.longitud_placa / maxLp) * hMax / 2;
      for (const [lado, y0, alto] of [["zneg", yTop - hn, hn], ["zpos", yTop - hn - hp, hp]]) {
        const p = n.panos[lado];
        p.tramos.forEach((t) => {
          const x1 = X(t.xi), x2 = X(t.xf);
          s += `<rect x="${x1}" y="${y0}" width="${x2 - x1}" height="${alto}" class="banda ${lado}"><title>${LADOS[lado]} · ${esc(p.carga ?? "")} · placa ${fmt(p.longitud_placa)} m · q PP ${fmt2(p.q.PP)} kN/m</title></rect>`;
          if (x2 - x1 > 80 && alto > 11) s += `<text x="${(x1 + x2) / 2}" y="${y0 + alto / 2 + 4}" class="rotulo-banda">${LADOS[lado]} ${fmt(p.longitud_placa)} m · ${esc(p.carga ?? "")}</text>`;
        });
      }
      // lineales: barra fina sobre las placas
      const yLin = yTop - hn - hp - 6;
      n.lineales.forEach((c) => {
        s += `<rect x="${X(c.x0)}" y="${yLin - 5}" width="${X(c.xf) - X(c.x0)}" height="5" class="carga-lineal"><title>${esc(c.carga)} · ${fmt2(c.x0)}–${fmt2(c.xf)} m · ${c.e ? `e ${fmt(c.e)} ${LADOS[c.lado]}` : "en eje"}</title></rect>`;
      });
      // puntuales: flecha; brochales: línea de puntos donde se inserta y flecha en x ± Δx
      n.puntuales.forEach((c) => (s += flecha(X(c.x), yTop, hMax + 14, "carga-puntual", `${c.carga} · x = ${fmt2(c.x)} m`)));
      n.brochales.forEach((c) => {
        const xi = X(c.x), xc = X(c.x_carga.PP);
        s += `<line x1="${xi}" y1="${yTop - hMax - 22}" x2="${xi}" y2="${yTop}" class="linea-brochal"/>`;
        s += flecha(xc, yTop, hMax + 14, "carga-brochal", `Brochal ${c.brochal} · x = ${fmt2(c.x)} m · R PP ${fmt2(c.R.PP)} kN en ${fmt2(c.x_carga.PP)} m`);
        s += `<text x="${xc + 6}" y="${yTop - hMax - 6}" class="rotulo-brochal">${esc(c.brochal)}</text>`;
      });
      // viga (con voladizos), color del canto, rótulas y rótulos
      const color = colorCanto(n.canto);
      s += `<line x1="${X(n.x_min)}" y1="${yTop}" x2="${X(n.x_max)}" y2="${yTop}" class="viga"${color ? ` style="stroke:${esc(color)}"` : ""}/>`;
      if (color) s += `<rect x="0" y="${yTop}" width="5" height="${h}" rx="2" style="fill:${esc(color)}"/>`;
      n.rotulas.forEach((r) => (s += `<circle cx="${X(r.x)}" cy="${yTop}" r="5" class="rotula"><title>Rótula ${esc(r.origen)} · x = ${fmt2(r.x)} m</title></circle>`));
      s += `<text x="12" y="${yTop + 16}" class="rotulo-nivel">${esc(n.nombre)}</text>`;
      s += `<text x="12" y="${yTop + 32}" class="rotulo-sub">h = ${fmt(n.altura)} m</text>`;
      if (n.tipo_planta && n.tipo_planta !== n.nombre) s += `<text x="12" y="${yTop + 46}" class="rotulo-sub">${esc(n.tipo_planta)}</text>`;
      s += `<text x="12" y="${yTop + 60}" class="rotulo-sub">canto ${esc(n.canto ?? "—")} cm</text>`;
      yBase = yTop;
    });

    const y0 = H - abajo; // empotramientos y cotas entre pilares
    xs.forEach((x) => {
      s += `<line x1="${X(x) - 12}" y1="${y0}" x2="${X(x) + 12}" y2="${y0}" class="base"/>`;
      for (let k = -12; k < 12; k += 6) s += `<line x1="${X(x) + k}" y1="${y0 + 6}" x2="${X(x) + k + 6}" y2="${y0}" class="rayado"/>`;
    });
    const yc = y0 + 30;
    s += `<line x1="${X(xs[0])}" y1="${yc}" x2="${X(xs[xs.length - 1])}" y2="${yc}" class="cota"/>`;
    xs.forEach((x, i) => {
      s += `<line x1="${X(x)}" y1="${yc - 5}" x2="${X(x)}" y2="${yc + 5}" class="cota"/>`;
      if (i > 0) s += `<text x="${(X(xs[i - 1]) + X(x)) / 2}" y="${yc - 6}" class="rotulo-cota">${fmt(x - xs[i - 1])}</text>`;
    });
    return s + `</svg>`;
  }

  // ---- pestaña Tipos de planta: solo la planta (el alzado está en las demás pestañas) ----
  function dibujarTipoPlanta(I) {
    ponerLeyenda([["zpos", "placas z+"], ["zneg", "placas z−"], ["brochal", "placas de brochal"], ["rotula", "rótula"]]);
    document.getElementById("titulo-dibujo").textContent = tipoActual ? `Planta · tipo «${tipoActual}»` : "Tipo de planta";
    const tp = tipoActual && I.tipos_planta ? I.tipos_planta[tipoActual] : null;
    if (!tp) {
      cont.innerHTML = `<p class="vacio">${tipoActual ? "Este tipo de planta tiene errores: revisa los avisos." : "Crea un tipo de planta para verlo aquí."}</p>`;
      return;
    }
    cont.innerHTML = svgPlanta(I, tp);
  }

  function svgPlanta(I, tp) {
    const xs = I.x_pilares;
    const xMin = Math.min(xs[0], tp.x_min), xMax = Math.max(xs[xs.length - 1], tp.x_max);
    const W = Math.max(cont.clientWidth, 320);
    const izq = 46, der = 24;
    const sx = (W - izq - der) / Math.max(xMax - xMin, 1);
    const X = (x) => izq + (x - xMin) * sx;
    // profundidad en z (distancia al eje de la viga): a escala, pero limitada para que el dibujo no sea enorme
    const semi = tp.semiancho_viga || 0.35;
    const lejos = (lado) => Math.max(semi + 1.2,
      ...tp.panos[lado].rectangulos.map((r) => r[3]),
      ...tp.brochales.filter((b) => b.lado === lado).flatMap((b) => [b.luz, ...b.rectangulos.map((r) => r[3])]));
    const sz = Math.min(sx, 150 / Math.max(lejos("zpos"), lejos("zneg")));
    const yViga = 26 + lejos("zpos") * sz, yBajo = yViga + lejos("zneg") * sz;
    const yNombres = yBajo + 16, yParcial = yBajo + 42, yTotal = yBajo + 72, H = yBajo + 92;
    const Y = (lado, d) => yViga + (lado === "zpos" ? -1 : 1) * d * sz;
    const caja = (x1, x2, ya, yb, clase, titulo) =>
      `<rect x="${X(x1)}" y="${Math.min(ya, yb)}" width="${X(x2) - X(x1)}" height="${Math.max(Math.abs(yb - ya), 1)}" class="${clase}">${titulo ? `<title>${esc(titulo)}</title>` : ""}</rect>`;
    // símbolo de forjado unidireccional: línea en la dirección de trabajo de la placa, con flechas a los apoyos
    const simbolo = (px1, py1, px2, py2, texto) => {
      const L = Math.hypot(px2 - px1, py2 - py1);
      if (L < 26) return "";
      const ux = (px2 - px1) / L, uy = (py2 - py1) / L, m = 7, a = 4;
      const punta = (px, py, sx_, sy_) => `M${px},${py} L${px - sx_ * m - sy_ * a},${py - sy_ * m + sx_ * a} L${px - sx_ * m + sy_ * a},${py - sy_ * m - sx_ * a} Z`;
      const ax = px1 + ux * 3, ay = py1 + uy * 3, bx = px2 - ux * 3, by = py2 - uy * 3;
      return `<g class="sentido-forjado"><line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>` +
             `<path d="${punta(ax, ay, -ux, -uy)} ${punta(bx, by, ux, uy)}"/>` +
             (texto ? `<text x="${(ax + bx) / 2 + (Math.abs(uy) > 0.5 ? 5 : 0)}" y="${(ay + by) / 2 + (Math.abs(uy) > 0.5 ? 4 : -5)}" class="rotulo-pano"${Math.abs(uy) > 0.5 ? ' text-anchor="start"' : ""}>${esc(texto)}</text>` : "") + `</g>`;
    };

    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="alzado" role="img" aria-label="Planta">`;
    for (const lado of ["zpos", "zneg"]) { // placas de la viga: desde su cara (0,35) hasta la longitud de placa
      const p = tp.panos[lado];
      p.rectangulos.forEach(([x1, x2, d1, d2]) => {
        s += caja(x1, x2, Y(lado, d1), Y(lado, d2), `banda ${lado}`, `Paño ${LADOS[lado]} · ${p.carga ?? ""} · placa ${fmt(p.longitud_placa)} m`);
        s += simbolo((X(x1) + X(x2)) / 2, Y(lado, d1), (X(x1) + X(x2)) / 2, Y(lado, d2), `${fmt(p.longitud_placa)} m · ${p.carga ?? ""}`);
      });
      s += `<text x="${izq - 10}" y="${Y(lado, semi + 0.6) + 4}" class="rotulo-nivel" text-anchor="end">${LADOS[lado]}</text>`;
    }
    tp.brochales.forEach((b) => { // brochales: su ancho de 70 cm, su eje y sus placas (que trabajan en x)
      b.rectangulos.forEach(([x1, x2, d1, d2]) => {
        s += caja(x1, x2, Y(b.lado, d1), Y(b.lado, d2), "banda brochal", `Placas del brochal ${b.brochal} · ${fmt(x2 - x1)} m`);
        const ym = (Y(b.lado, d1) + Y(b.lado, d2)) / 2;
        s += simbolo(X(x1), ym, X(x2), ym, `${fmt(x2 - x1)} m`);
      });
      s += caja(b.x - semi, b.x + semi, Y(b.lado, semi), Y(b.lado, b.luz), "brochal-planta", `Brochal ${b.brochal} · luz ${fmt(b.luz)} m`);
      s += `<line x1="${X(b.x)}" y1="${Y(b.lado, semi)}" x2="${X(b.x)}" y2="${Y(b.lado, b.luz)}" class="linea-brochal"/>`;
      s += `<text x="${X(b.x + semi) + 3}" y="${Y(b.lado, b.luz) + (b.lado === "zpos" ? 12 : -4)}" class="rotulo-brochal">${esc(b.brochal)}</text>`;
      // dónde actúa su reacción sobre la viga: x ± Δx, en el tacón de ese lado
      const yc = Y(b.lado, semi) + (b.lado === "zpos" ? -1 : 1);
      s += `<path d="M${X(b.x_carga.PP) - 6},${yc} L${X(b.x_carga.PP) + 6},${yc} L${X(b.x_carga.PP)},${yc + (b.lado === "zpos" ? 8 : -8)} Z" class="carga-brochal-planta"><title>Reacción del brochal ${esc(b.brochal)}: R PP ${fmt2(b.R.PP)} kN en x = ${fmt2(b.x_carga.PP)} m (Δx ${fmt2(b.dx.PP)} m)</title></path>`;
    });
    // la viga (70 cm, con voladizos), lineales, pilares, rótulas y puntuales
    s += caja(tp.x_min, tp.x_max, Y("zpos", semi), Y("zneg", semi), "viga-planta", `Viga · canto ${tp.canto} cm · 70 cm de ancho`)
      .replace("<rect ", `<rect style="fill:${esc(tp.color || "#1d2330")}" `);
    tp.lineales.forEach((c) => { // lineales: línea a trazos a su lado (o en eje)
      const y = c.e ? Y(c.lado, Math.min(c.e, semi)) : yViga;
      s += `<line x1="${X(c.x0)}" y1="${y}" x2="${X(c.xf)}" y2="${y}" class="carga-lineal-planta"><title>${esc(c.carga)}</title></line>`;
    });
    I.pilares.forEach((p) => {
      s += `<rect x="${X(p.x) - 7}" y="${yViga - 7}" width="14" height="14" class="pilar-planta"><title>${esc(p.nombre)} · x = ${fmt2(p.x)} m</title></rect>`;
      s += `<text x="${X(p.x)}" y="${yNombres}" class="rotulo-sub" text-anchor="middle">${esc(p.nombre)}</text>`;
    });
    tp.rotulas.forEach((r) => (s += `<circle cx="${X(r.x)}" cy="${yViga}" r="5" class="rotula"><title>Rótula ${esc(r.origen)} · x = ${fmt2(r.x)} m</title></circle>`));
    tp.puntuales.forEach((c) => (s += `<circle cx="${X(c.x)}" cy="${c.e ? Y(c.lado, Math.min(c.e, semi)) : yViga}" r="4" class="puntual-planta"><title>${esc(c.carga)} · x = ${fmt2(c.x)} m</title></circle>`));

    // cotas: parciales (voladizos y vanos entre pilares) y total de la viga
    const puntos = [...(tp.x_min < xs[0] - 1e-6 ? [tp.x_min] : []), ...xs, ...(tp.x_max > xs[xs.length - 1] + 1e-6 ? [tp.x_max] : [])];
    const cota = (y, xsCota, rotulos) => {
      let c = `<line x1="${X(xsCota[0])}" y1="${y}" x2="${X(xsCota[xsCota.length - 1])}" y2="${y}" class="cota"/>`;
      xsCota.forEach((x) => (c += `<line x1="${X(x)}" y1="${y - 5}" x2="${X(x)}" y2="${y + 5}" class="cota"/>`));
      rotulos.forEach(([a, b, texto]) => (c += `<text x="${(X(a) + X(b)) / 2}" y="${y - 6}" class="rotulo-cota">${texto}</text>`));
      return c;
    };
    const parciales = puntos.slice(1).map((x, i) => {
      const a = puntos[i], vol = a < xs[0] - 1e-6 || x > xs[xs.length - 1] + 1e-6;
      return [a, x, `${vol ? "vol. " : ""}${fmt(x - a)} m`];
    });
    s += cota(yParcial, puntos, parciales);
    s += cota(yTotal, [puntos[0], puntos[puntos.length - 1]], [[puntos[0], puntos[puntos.length - 1], `total ${fmt(puntos[puntos.length - 1] - puntos[0])} m`]]);
    s += `<text x="${W - 6}" y="${yTotal + 16}" class="rotulo-sub" text-anchor="end">x →</text>`;
    return s + `</svg>`;
  }

  // ---- pestaña Brochales: planta del brochal (+x arriba, −x abajo, eje +z hacia la derecha) ----
  function dibujarBrochal(I) {
    ponerLeyenda([["zpos", "paño +x"], ["zneg", "paño −x"]]);
    document.getElementById("titulo-dibujo").textContent = brochalActual ? `Brochal «${brochalActual}»` : "Brochales";
    const b = brochalActual && I.brochales ? I.brochales[brochalActual] : null;
    if (!b) {
      cont.innerHTML = `<p class="vacio">${brochalActual ? "Este brochal tiene errores: revisa los avisos." : "Crea un brochal para verlo aquí."}</p>`;
      return;
    }
    const W = Math.max(cont.clientWidth, 320);
    const izq = 56, der = 44, hMax = 130;
    const L = b.luz || 1;
    const X = (x) => izq + x * ((W - izq - der) / L);
    const maxLp = Math.max(1, b.panos.xpos.longitud_placa, b.panos.xneg.longitud_placa);
    const prof = (lp) => Math.max(18, (lp / maxLp) * hMax);
    const yViga = 34 + hMax, H = yViga + hMax + 70;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="alzado" role="img" aria-label="Planta del brochal">`;
    for (const [lado, signo, clase, etiqueta] of [["xpos", -1, "zpos", "+x"], ["xneg", 1, "zneg", "−x"]]) {
      const p = b.panos[lado];
      const d = prof(p.longitud_placa);
      p.tramos.forEach((t) => {
        const x1 = X(Math.max(0, t.xi)), x2 = X(Math.min(b.luz, t.xf));
        if (x2 <= x1) return;
        const y = signo < 0 ? yViga - d : yViga;
        s += `<rect x="${x1}" y="${y}" width="${x2 - x1}" height="${d}" class="banda ${clase}"><title>Paño ${etiqueta} · ${fmt2(t.xi)}–${fmt2(t.xf)} m · placa ${fmt(p.longitud_placa)} m · ${esc(p.carga ?? "")}</title></rect>`;
        if (x2 - x1 > 60) {
          s += `<text x="${(x1 + x2) / 2}" y="${y + d / 2 + 4}" class="rotulo-pano">${fmt(p.longitud_placa)} m</text>`;
          if (d > 34 && p.carga) s += `<text x="${(x1 + x2) / 2}" y="${y + d / 2 + 18}" class="rotulo-banda">${esc(p.carga)}</text>`;
        }
      });
      s += `<text x="${izq - 12}" y="${yViga + signo * 22 + 4}" class="rotulo-nivel" text-anchor="end">${etiqueta}</text>`;
      if (p.modo === "sin") s += `<text x="${(X(0) + X(b.luz)) / 2}" y="${yViga + signo * 24 + 4}" class="rotulo-sub" text-anchor="middle">sin placas</text>`;
    }
    s += `<line x1="${X(0)}" y1="${yViga}" x2="${X(b.luz)}" y2="${yViga}" class="viga brochal"/>`;
    [0, b.luz].forEach((x) => (s += `<rect x="${X(x) - 5}" y="${yViga - 5}" width="10" height="10" class="apoyo-brochal"/>`));
    const yc = H - 28;
    s += `<line x1="${X(0)}" y1="${yc}" x2="${X(b.luz)}" y2="${yc}" class="cota"/>`;
    [0, b.luz].forEach((x) => (s += `<line x1="${X(x)}" y1="${yc - 5}" x2="${X(x)}" y2="${yc + 5}" class="cota"/>`));
    s += `<text x="${(X(0) + X(b.luz)) / 2}" y="${yc - 6}" class="rotulo-cota">luz ${fmt(b.luz)} m · canto ${esc(b.canto)} cm</text>`;
    s += `<text x="${X(0)}" y="${yc + 18}" class="rotulo-sub" text-anchor="middle">z = 0 (viga)</text>`;
    const xe = X(b.luz) + 8;
    s += `<line x1="${xe}" y1="${yViga}" x2="${xe + 18}" y2="${yViga}" class="eje"/>` +
         `<path d="M${xe + 13},${yViga - 4} L${xe + 19},${yViga} L${xe + 13},${yViga + 4}" class="eje"/>` +
         `<text x="${xe + 10}" y="${yViga - 8}" class="rotulo-sub" text-anchor="middle">+z</text>`;
    cont.innerHTML = s + `</svg>`;
  }

  // ---- pestaña Pilares: solo la alineación de pilares, con nombres, posiciones y cotas ----
  function dibujarPilares(I) {
    ponerLeyenda([]);
    document.getElementById("titulo-dibujo").textContent = "Pilares";
    const pil = I.pilares || [];
    if (!pil.length) { cont.innerHTML = `<p class="vacio">Añade pilares para verlos aquí.</p>`; return; }
    const W = Math.max(cont.clientWidth, 320);
    const izq = 36, der = 36, L = I.longitud_total || 1;
    const X = (x) => izq + (x / L) * (W - izq - der);
    const yEje = 70, yCota = 130, H = 170;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="alzado" role="img" aria-label="Alineación de pilares">`;
    s += `<line x1="${X(0)}" y1="${yEje}" x2="${X(L)}" y2="${yEje}" class="eje-pilares"/>`;
    pil.forEach((p) => {
      s += `<rect x="${X(p.x) - 9}" y="${yEje - 9}" width="18" height="18" class="pilar-planta"><title>${esc(p.nombre)} · x = ${fmt2(p.x)} m · ${esc(p.seccion)}</title></rect>`;
      s += `<text x="${X(p.x)}" y="${yEje - 18}" class="rotulo-nivel" text-anchor="middle">${esc(p.nombre)}</text>`;
      s += `<text x="${X(p.x)}" y="${yEje + 28}" class="rotulo-sub" text-anchor="middle">x = ${fmt2(p.x)}</text>`;
    });
    s += `<line x1="${X(0)}" y1="${yCota}" x2="${X(L)}" y2="${yCota}" class="cota"/>`;
    pil.forEach((p, i) => {
      s += `<line x1="${X(p.x)}" y1="${yCota - 5}" x2="${X(p.x)}" y2="${yCota + 5}" class="cota"/>`;
      if (i > 0) s += `<text x="${(X(pil[i - 1].x) + X(p.x)) / 2}" y="${yCota - 6}" class="rotulo-cota">${fmt(p.x - pil[i - 1].x)}</text>`;
    });
    s += `<text x="${(X(0) + X(L)) / 2}" y="${yCota + 22}" class="rotulo-cota">longitud total ${fmt(L)} m</text>`;
    cont.innerHTML = s + `</svg>`;
  }

  // ---------------- arranque ----------------
  Promise.all(Object.values(tablas).map((t) => t.listo)).then(async () => {
    await cargarTipo(tipoActual);
    cargarBrochal(brochalActual);
    interpretarAhora();
  });
})();
