"""
Interpretación del proyecto de pórtico (sin cálculo estructural).

Convierte el JSON del proyecto (lo que edita el usuario) en lo que necesitará el motor:
pilares y, para cada nivel, voladizos, rótulas, estabilidad de la viga, cargas por metro,
cargas puntuales y torsores, más la secuencia de fases. Devuelve también avisos para
detectar errores de entrada.

Modelo de datos del proyecto:
  generales        {ingeniero}
  cargas_pano      [{nombre, CM, SC, desfase_CM}]                     kN/m²
  cargas_lineales  [{nombre, pp_activo, PP, CM, SC, desfase_CM}]      kN/m  (PP solo si pp_activo)
  cargas_puntuales [{nombre, pp_activo, PP, CM, SC, desfase_CM}]      kN
  brochales        [{nombre, luz, canto, panos: {xpos: PAÑO, xneg: PAÑO}}]   tramos en z, de 0 a la luz
  pilares          {lista: [{nombre, separacion}]}     separación al anterior (la del primero no cuenta)
  tipos_planta     [TIPO]
  niveles          [{nombre, altura, tipo_planta}]     de abajo arriba (orden de montaje)

  PAÑO = {modo: completo|parcial|sin, longitud_placa, carga, tramos: [{xi, xf}]}
         aportación = longitud de placa / 2
  TIPO = {nombre, canto,                                canto: "35" | "40" | "45" (catálogo)
          voladizos: {inicio: {activo, longitud}, fin: {activo, longitud}},
          panos: {zpos: PAÑO, zneg: PAÑO},              tramos en x de la viga
          rotulas_tipicas: ["<índice de pilar>:izq" | "<índice>:der"],   a 1,20 m del pilar, hacia dentro
          rotulas_mano: [{x}],
          lineales: [{x0, xf, carga, e, lado}], puntuales: [{x, carga, e, lado}],
          brochales: [{x, brochal, lado}]}               lado: "zpos" | "zneg"

x: a lo largo de la viga, desde el primer pilar (negativa en el voladizo inicial).
Lo que apoya en el tacón (placas y brochales) tiene excentricidad fija (catálogo, 0,40 m).
"""
import json
from pathlib import Path

CATALOGO = json.loads((Path(__file__).parent / "catalogo.json").read_text(encoding="utf-8-sig"))

COMPONENTES = ("PP", "CM", "SC")
LADOS_VIGA = (("zpos", "z+", 1.0), ("zneg", "z−", -1.0))
LADOS_BROCHAL = (("xpos", "+x"), ("xneg", "−x"))
TOL = 1e-6

E_TACON = CATALOGO["excentricidad_tacon"]
SEMIANCHO = CATALOGO["ancho_viga"] / 2  # vigas y brochales de 70 cm: las placas empiezan a 0,35 del eje
DIST_ROTULA_TIPICA = CATALOGO["distancia_rotula_tipica"]
CANTO_POR_DEFECTO = "35"
DESFASE_CM = 3  # de momento fijo para todas las cargas (en gris en la interfaz)
GRUPO_CARGAS_POR_DEFECTO = {"nombre": "Vivienda", "CM": 2.0, "SC": 2.0, "desfase_CM": DESFASE_CM}
SECCION_PILAR = "30×30"           # de momento fija (en gris): la calculará el programa
SEPARACION_MIN, SEPARACION_MAX = 2.0, 15.0  # fuera de este rango se avisa (posible error de tecleo)


def _lista_pilares(separaciones):
    """Pilares P1, P2… a partir de las separaciones entre ellos."""
    if not separaciones:
        return []
    return [{"nombre": "P1", "separacion": None}] + [
        {"nombre": f"P{i + 2}", "separacion": s} for i, s in enumerate(separaciones)]


def pano_por_defecto(carga=None, modo="completo"):
    return {"modo": modo, "longitud_placa": None, "carga": carga, "tramos": []}


def tipo_planta_nuevo(nombre, carga=None):
    return {
        "nombre": nombre, "canto": CANTO_POR_DEFECTO,
        "voladizos": {"inicio": {"activo": False, "longitud": None}, "fin": {"activo": False, "longitud": None}},
        "panos": {"zpos": pano_por_defecto(carga), "zneg": pano_por_defecto(carga)},
        "rotulas_tipicas": [], "rotulas_mano": [],
        "lineales": [], "puntuales": [], "brochales": [],
    }


def proyecto_nuevo():
    """Datos de un proyecto recién creado: un ejemplo pequeño y editable."""
    tipo = tipo_planta_nuevo("Tipo", GRUPO_CARGAS_POR_DEFECTO["nombre"])
    for lado in ("zpos", "zneg"):
        tipo["panos"][lado]["longitud_placa"] = 10.0
    tipo["rotulas_tipicas"] = ["1:izq", "1:der", "2:izq", "2:der"]  # las típicas de los pilares interiores
    return {
        "generales": {"ingeniero": ""},
        "cargas_pano": [dict(GRUPO_CARGAS_POR_DEFECTO)],
        "cargas_lineales": [],
        "cargas_puntuales": [],
        "brochales": [],
        "pilares": {"lista": _lista_pilares([7.5, 7.5, 7.0])},
        "tipos_planta": [tipo],
        "niveles": [{"nombre": "Planta 1", "altura": 4.0, "tipo_planta": "Tipo"}],
    }


# ---------------------------------------------------------------- migración

CANTO_DE_VIGA_ANTIGUA = {"V30": "35", "V40": "40"}


def migrar(datos):
    """Lleva un proyecto de cualquier formato anterior al actual. Idempotente."""
    d = json.loads(json.dumps(datos or {}))
    d.setdefault("generales", {"ingeniero": ""})
    if "cargas_pano" not in d:  # antes se llamaban «grupos de cargas»
        d["cargas_pano"] = d.pop("grupos_cargas", None) or [dict(GRUPO_CARGAS_POR_DEFECTO)]
    d.pop("grupos_cargas", None)
    d.setdefault("cargas_lineales", [])
    d.setdefault("cargas_puntuales", [])
    d.setdefault("brochales", [])
    d.setdefault("pilares", {})
    if "lista" not in d["pilares"]:  # antes: solo separaciones entre pilares
        d["pilares"] = {"lista": _lista_pilares(d["pilares"].get("separaciones") or [])}

    if "tipos_planta" not in d:  # formato inicial: rótulas, forjado y grupo de cargas en cada nivel
        _migrar_niveles_a_tipos(d)
    tipos_forjado = {f.get("nombre"): f for f in d.get("tipos_forjado") or []}
    L = sum(num(p.get("separacion")) or 0 for p in d["pilares"]["lista"][1:])  # longitud entre pilares extremos
    d["tipos_planta"] = [_migrar_tipo_planta(tp, tipos_forjado, L) for tp in d.get("tipos_planta") or []]
    d.setdefault("niveles", [])
    for clave in ("grupos", "por_defecto", "tipos_forjado"):
        d.pop(clave, None)
    return d


def _migrar_niveles_a_tipos(d):
    grupos_antiguos = d.get("grupos") or {}
    tipo_carga = (d["cargas_pano"][0].get("nombre") if d["cargas_pano"] else None) or "General"
    forjado_defecto = (d.get("tipos_forjado") or [{}])[0].get("nombre")
    combinaciones = []  # (forjado, rótulas, grupo antiguo), en orden de aparición
    for n in d.get("niveles") or []:
        clave = (n.get("forjado") or forjado_defecto, n.get("rotulas") or "", n.get("grupo"))
        if clave not in combinaciones:
            combinaciones.append(clave)
    tipos, nombre_de = [], {}
    for k, (forjado, rotulas, grupo) in enumerate(combinaciones):
        nombre = "Tipo" if len(combinaciones) == 1 else f"Tipo ({forjado})"
        if nombre in nombre_de.values():
            nombre = f"Tipo {k + 1}"
        nombre_de[(forjado, rotulas, grupo)] = nombre
        g = grupos_antiguos.get(grupo) or {}
        cargas = []
        for c in g.get("cargas_superficiales") or []:
            zp, zn = num(c.get("luz_placa_zpos")), num(c.get("luz_placa_zneg"))
            cargas.append({"inicio": c.get("inicio"), "fin": c.get("fin"), "tipo": tipo_carga,
                           "aport_zpos": zp / 2 if zp is not None else None,
                           "aport_zneg": zn / 2 if zn is not None else None})
        tipos.append({"nombre": nombre, "forjado": forjado, "rotulas": rotulas, "cargas": cargas,
                      "puntuales_anteriores": g.get("cargas_puntuales") or []})
    d["tipos_planta"] = tipos
    d["niveles"] = [{
        "nombre": n.get("nombre"), "altura": n.get("altura"),
        "tipo_planta": nombre_de.get((n.get("forjado") or forjado_defecto, n.get("rotulas") or "", n.get("grupo"))),
    } for n in d.get("niveles") or []]


def _migrar_tipo_planta(tp, tipos_forjado, L):
    """Tipo de planta con forjado + rótulas en texto + tramos con aportación → canto, paños y rótulas.
    Un tramo antiguo que cubría toda la viga (0 a L o más) pasa a paño completo."""
    if "canto" in tp:
        return tp
    nuevo = tipo_planta_nuevo(tp.get("nombre"))
    viga = (tipos_forjado.get(tp.get("forjado")) or {}).get("viga")
    nuevo["canto"] = CANTO_DE_VIGA_ANTIGUA.get(viga, CANTO_POR_DEFECTO)
    valores, _ = parse_rotulas(tp.get("rotulas"))
    nuevo["rotulas_mano"] = [{"x": x} for x in valores]
    tramos = tp.get("cargas") or []
    for lado in ("zpos", "zneg"):
        con_placa = [t for t in tramos if (num(t.get(f"aport_{lado}")) or 0) > 0]
        if not con_placa:
            nuevo["panos"][lado] = pano_por_defecto(modo="sin")
            continue
        cubre_todo = len(con_placa) == 1 and (num(con_placa[0].get("inicio")) or 0) <= TOL \
            and (num(con_placa[0].get("fin")) or 0) >= L - TOL
        nuevo["panos"][lado] = {
            "modo": "completo" if cubre_todo else "parcial", "carga": con_placa[0].get("tipo"),
            "longitud_placa": 2 * num(con_placa[0].get(f"aport_{lado}")),  # la aportación era la mitad
            "tramos": [{"xi": t.get("inicio"), "xf": t.get("fin")} for t in con_placa],
        }
    if tp.get("puntuales_anteriores"):
        nuevo["puntuales_anteriores"] = tp["puntuales_anteriores"]
    return nuevo


# ---------------------------------------------------------------- utilidades

def num(v):
    """Número desde texto o número; admite coma decimal. None si está vacío o no es válido."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(" ", "").replace(",", ".")
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def es_vacio(v):
    return v is None or (isinstance(v, str) and v.strip() == "")


def parse_rotulas(texto):
    """'9,5; 20.5' -> ([9.5, 20.5], ['tokens no válidos'])  (formato antiguo de rótulas)."""
    if isinstance(texto, list):
        tokens = [str(t) for t in texto]
    else:
        tokens = str(texto or "").replace("\n", ";").split(";")
    valores, malos = [], []
    for t in tokens:
        t = t.strip()
        if not t:
            continue
        n = num(t)
        (valores if n is not None else malos).append(n if n is not None else t)
    return sorted(valores), malos


def _fmt(x):
    return f"{x:.2f}".replace(".", ",")


def _nombres_validos(filas, que, aviso, donde):
    """Avisa de nombres vacíos o repetidos. Devuelve [(nombre, fila)] de las válidas."""
    vistos, buenas = set(), []
    for i, f in enumerate(filas):
        nombre = str(f.get("nombre") or "").strip()
        if not nombre:
            aviso("error", f"{que} de la fila {i + 1} sin nombre", donde)
            continue
        if nombre in vistos:
            aviso("error", f"{que} «{nombre}» repetido", donde)
            continue
        vistos.add(nombre)
        buenas.append((nombre, f))
    return buenas


def _rango(A, tol=1e-9):
    """Rango de una matriz (lista de filas) por eliminación de Gauss con pivote parcial."""
    M = [list(f) for f in A]
    if not M or not M[0]:
        return 0
    escala = max((abs(v) for f in M for v in f), default=1.0) or 1.0
    filas, cols, r = len(M), len(M[0]), 0
    for c in range(cols):
        piv = max(range(r, filas), key=lambda i: abs(M[i][c]), default=None)
        if piv is None or abs(M[piv][c]) <= tol * escala:
            continue
        M[r], M[piv] = M[piv], M[r]
        for i in range(r + 1, filas):
            f = M[i][c] / M[r][c]
            if f:
                M[i] = [a - f * b for a, b in zip(M[i], M[r])]
        r += 1
        if r == filas:
            break
    return r


def estabilidad_viga(x_pilares, rotulas_x, x_min, x_max, empotrados=None):
    """Viga sobre los pilares con rótulas. Cada pilar coarta el desplazamiento vertical y, si
    empotra la viga (`empotrados[i]`), también el giro; el horizontal se coarta una sola vez,
    en el primero, para no contar hiperestaticidades axiles. Monta las ecuaciones de equilibrio
    de cada tramo rígido entre rótulas y saca, por rango, el grado de hiperestaticidad y los
    mecanismos (también locales: tres rótulas en un vano, una rótula en un voladizo…)."""
    if empotrados is None:
        empotrados = [True] * len(x_pilares)
    rot = sorted(x for x in set(round(r, 6) for r in rotulas_x) if x_min + TOL < x < x_max - TOL)
    bordes = [x_min] + rot + [x_max]
    k = len(bordes) - 1  # tramos rígidos

    def tramo(x):  # una x en una rótula se asigna al tramo de la izquierda
        for j in range(k):
            if x <= bordes[j + 1] + TOL:
                return j
        return k - 1

    columnas = []  # cada incógnita: {(tramo, ecuación): coeficiente}; ecuaciones 0 Fx, 1 Fy, 2 M
    for i, x in enumerate(x_pilares):
        j = tramo(x)
        columnas.append({(j, 1): 1.0, (j, 2): x})  # reacción vertical
        if empotrados[i]:
            columnas.append({(j, 2): 1.0})         # momento de empotramiento
        if i == 0:
            columnas.append({(j, 0): 1.0})         # horizontal (una sola vez)
    for m, xh in enumerate(rot):  # rótula entre el tramo m y el m+1: transmite Fx y Fy
        columnas.append({(m, 0): 1.0, (m + 1, 0): -1.0})
        columnas.append({(m, 1): 1.0, (m, 2): xh, (m + 1, 1): -1.0, (m + 1, 2): -xh})
    A = [[c.get((j, e), 0.0) for c in columnas] for j in range(k) for e in range(3)]
    r = _rango(A)
    mecanismos, gh = 3 * k - r, len(columnas) - r
    estado = "mecanismo" if mecanismos > 0 else ("isostatica" if gh == 0 else "hiperestatica")
    return {"estado": estado, "gh": gh, "mecanismos": mecanismos, "rotulas": len(rot), "apoyos": len(x_pilares)}


# ---------------------------------------------------------------- interpretación

def interpretar(datos):
    p = migrar(datos)
    avisos = []

    def aviso(gravedad, texto, donde=""):
        avisos.append({"gravedad": gravedad, "texto": texto, "donde": donde})

    grupos = {}
    if not p["cargas_pano"]:
        aviso("error", "No hay ninguna carga de paño definida", "Cargas")
    for nombre, g in _nombres_validos(p["cargas_pano"], "Carga de paño", aviso, "Cargas"):
        grupos[nombre] = {"nombre": nombre, **_valores_carga(g, ("CM", "SC"), f"Carga de paño «{nombre}»", aviso)}
    lineales = _cargas_especiales(p["cargas_lineales"], "Carga lineal", aviso)
    puntuales = _cargas_especiales(p["cargas_puntuales"], "Carga puntual", aviso)
    brochales = {}
    for nombre, b in _nombres_validos(p["brochales"], "Brochal", aviso, "Brochales"):
        brochales[nombre] = _brochal(nombre, b, grupos, aviso)

    pilares = _pilares(p, aviso)
    x_pilares = [pl["x"] for pl in pilares] or [0.0]
    L = x_pilares[-1]

    ctx = {"x_pilares": x_pilares, "pilares": pilares, "grupos": grupos,
           "lineales": lineales, "puntuales": puntuales, "brochales": brochales}
    tipos = {}
    if not p["tipos_planta"]:
        aviso("error", "No hay ningún tipo de planta definido", "Tipos de planta")
    for nombre, tp in _nombres_validos(p["tipos_planta"], "Tipo de planta", aviso, "Tipos de planta"):
        tipos[nombre] = _tipo_planta(nombre, tp, ctx, aviso)

    # ---- niveles y fases ----
    niveles = p["niveles"]
    N = len(niveles)
    if N == 0:
        aviso("error", "No hay niveles definidos.", "Niveles")
    fases = [{"fase": i + 1, "estructura": f"Niveles 1 a {i + 1}" if i else "Nivel 1", "entra": []}
             for i in range(N)]
    fase_final = {"fase": "Final", "estructura": "Estructura completa", "entra": []}

    niveles_out, cota = [], 0.0
    for i, niv in enumerate(niveles):
        nombre = (niv.get("nombre") or "").strip() or f"Nivel {i + 1}"
        donde = f"Niveles · {nombre}"
        altura = num(niv.get("altura"))
        if altura is None or altura <= 0:
            aviso("error", f"Altura no válida: {niv.get('altura')!r}", donde)
            altura = 0.0
        cota += altura
        nombre_tipo = niv.get("tipo_planta")
        tp = tipos.get(nombre_tipo) if nombre_tipo else None
        if tp is None:
            aviso("error", f"Sin tipo de planta válido ({nombre_tipo!r})", donde)
            tp = _tipo_planta_vacio(x_pilares)
        niveles_out.append({"indice": i + 1, "nombre": nombre, "altura": altura, "cota": cota,
                            "tipo_planta": nombre_tipo, **tp})

        # fases: PP al montar el nivel · CM con el desfase de su carga · SC al final
        fases[i]["entra"].append(f"PP · {nombre}")
        for nombre_carga, desfase in tp["cargas_usadas"]:
            fases[min(i + desfase, N - 1)]["entra"].append(f"CM {nombre_carga} · {nombre}")
        fase_final["entra"].append(f"SC · {nombre}")

    for f in fases:  # dentro de cada fase: primero PP, después CM
        f["entra"].sort(key=lambda s: not s.startswith("PP"))

    # un tipo de planta usado por varios niveles repetiría avisos: quitar duplicados
    unicos = {(a["gravedad"], a["texto"], a["donde"]): a for a in avisos}

    return {
        "x_pilares": x_pilares,
        "pilares": pilares,
        "longitud_total": L,
        "cargas_pano": list(grupos.values()),
        "cargas_lineales": list(lineales.values()),
        "cargas_puntuales": list(puntuales.values()),
        "brochales": brochales,
        "tipos_planta": tipos,
        "niveles": niveles_out,
        "fases": fases + [fase_final],
        "avisos": list(unicos.values()),
    }


def _pilares(p, aviso):
    """El primer pilar en x = 0; cada uno a su separación del anterior."""
    pilares = []
    lista = p["pilares"].get("lista") or []
    if len(lista) < 2:
        aviso("error", "Hacen falta al menos dos pilares.", "Pilares")
    vistos = set()
    for i, pil in enumerate(lista):
        nombre = str(pil.get("nombre") or "").strip() or f"P{i + 1}"
        if nombre in vistos:
            aviso("aviso", f"Nombre de pilar repetido: «{nombre}»", "Pilares")
        vistos.add(nombre)
        if i == 0:
            x = 0.0
        else:
            s = num(pil.get("separacion"))
            if s is None or s <= 0:
                aviso("error", f"{nombre}: separación no válida ({pil.get('separacion')!r})", "Pilares")
                continue
            if s < SEPARACION_MIN or s > SEPARACION_MAX:
                aviso("aviso", f"{nombre}: separación de {_fmt(s)} m poco habitual "
                               f"(entre {_fmt(SEPARACION_MIN)} y {_fmt(SEPARACION_MAX)} m); ¿error de tecleo?", "Pilares")
            x = pilares[-1]["x"] + s
        pilares.append({"nombre": nombre, "x": x, "indice": i, "seccion": SECCION_PILAR})
    return pilares


def _valores_carga(c, claves, que, aviso):
    """CM, SC (y PP si está activado) de una carga de la biblioteca, más el desfase de la CM."""
    valores = {}
    for k in claves:
        n = num(c.get(k))
        if n is None:
            if not es_vacio(c.get(k)):
                aviso("error", f"{que}: {k} no es un número ({c.get(k)!r})", "Cargas")
            n = 0.0
        if n < 0:
            aviso("error", f"{que}: {k} negativo", "Cargas")
        valores[k] = n
    d = num(c.get("desfase_CM"))
    valores["desfase_CM"] = int(round(d)) if d is not None else DESFASE_CM
    return valores


def _cargas_especiales(filas, que, aviso):
    """Biblioteca de cargas lineales (kN/m) o puntuales (kN). El PP solo cuenta si está activado."""
    out = {}
    for nombre, c in _nombres_validos(filas, que, aviso, "Cargas"):
        v = _valores_carga(c, ("PP", "CM", "SC"), f"{que} «{nombre}»", aviso)
        if not c.get("pp_activo"):
            v["PP"] = 0.0
        if v["PP"] == v["CM"] == v["SC"] == 0:
            aviso("aviso", f"{que} «{nombre}» sin ningún valor", "Cargas")
        out[nombre] = {"nombre": nombre, "pp_activo": bool(c.get("pp_activo")), **v}
    return out


def _pano(pano, xa, xb, grupos, aviso, donde, eje="x"):
    """Un paño (lo que apoya en el tacón a un lado): tramos ocupados, longitud de placa y carga.
    [xa, xb] es la extensión de la pieza (viga o brochal) sobre la que apoya."""
    pano = pano or {}
    modo = pano.get("modo") or "completo"
    out = {"modo": modo, "tramos": [], "longitud_placa": 0.0, "aportacion": 0.0, "carga": None}
    if modo == "sin":
        return out
    if modo not in ("completo", "parcial"):
        aviso("error", f"Modo de paño no válido ({modo!r})", donde)
        return out

    lp = num(pano.get("longitud_placa"))
    if lp is None or lp <= 0:
        aviso("error", "Falta la longitud de placa (o no es válida)", donde)
        lp = 0.0
    out["longitud_placa"], out["aportacion"] = lp, lp / 2

    carga = pano.get("carga")
    if carga not in grupos:
        aviso("error", f"Carga de paño no válida ({carga!r})", donde)
    else:
        out["carga"] = carga

    if modo == "completo":
        out["tramos"] = [{"xi": xa, "xf": xb}] if xb > xa else []
        return out

    tramos = []
    for j, t in enumerate(pano.get("tramos") or []):
        if es_vacio(t.get("xi")) and es_vacio(t.get("xf")):
            continue
        xi, xf = num(t.get("xi")), num(t.get("xf"))
        if xi is None or xf is None:
            aviso("error", f"Tramo {j + 1}: falta {eje} inicial o final", donde)
            continue
        if xf <= xi:
            aviso("error", f"Tramo {j + 1}: {eje} final ({_fmt(xf)}) no es mayor que la inicial ({_fmt(xi)})", donde)
            continue
        if xi < xa - TOL or xf > xb + TOL:
            aviso("error", f"Tramo {j + 1}: {_fmt(xi)}–{_fmt(xf)} m sale de la pieza ({_fmt(xa)} a {_fmt(xb)} m)", donde)
        tramos.append({"xi": xi, "xf": xf})
    if not tramos:
        aviso("error", "Paño parcial sin tramos", donde)
    tramos.sort(key=lambda t: t["xi"])
    for a, b in zip(tramos, tramos[1:]):
        if b["xi"] < a["xf"] - TOL:
            aviso("error", f"Tramos solapados entre {_fmt(b['xi'])} y {_fmt(min(a['xf'], b['xf']))} m", donde)
    out["tramos"] = tramos
    return out


def _w_pano(pano, k, peso_placa, grupos):
    """Carga superficial (kN/m²) de un paño para la hipótesis k: PP de la placa, CM y SC de su carga."""
    if k == "PP":
        return peso_placa
    g = grupos.get(pano["carga"]) if pano["carga"] else None
    return g[k] if g else 0.0


# ---------------------------------------------------------------- brochales

def _brochal(nombre, b, grupos, aviso):
    donde = f"Brochales · {nombre}"
    luz = num(b.get("luz"))
    if luz is None or luz <= 0:
        aviso("error", f"Luz no válida ({b.get('luz')!r})", donde)
        luz = 0.0
    canto = str(b.get("canto") or "")
    datos_canto = CATALOGO["cantos"].get(canto)
    if datos_canto is None:
        aviso("error", f"Canto no válido ({b.get('canto')!r})", donde)
    panos = {}
    for lado, etiqueta in LADOS_BROCHAL:
        panos[lado] = _pano((b.get("panos") or {}).get(lado), 0.0, luz, grupos, aviso,
                            f"{donde} · paño {etiqueta}", eje="z")
    if all(panos[l]["modo"] == "sin" for l, _ in LADOS_BROCHAL):
        aviso("aviso", "Brochal sin paños a ningún lado", donde)
    peso_propio = datos_canto["peso_viga"] if datos_canto else 0.0
    peso_placa = CATALOGO["placas"][datos_canto["placa"]]["peso"] if datos_canto else 0.0
    return {
        "nombre": nombre, "luz": luz, "canto": canto,
        "peso_propio": peso_propio, "peso_placa": peso_placa, "excentricidad": E_TACON,
        "panos": panos,
        "cargas_usadas": sorted({panos[l]["carga"] for l, _ in LADOS_BROCHAL if panos[l]["carga"]}),
        "reacciones": _reacciones_brochal(luz, panos, grupos, peso_placa, peso_propio, E_TACON),
    }


def _reacciones_brochal(L, panos, grupos, peso_placa, peso_propio, e):
    """Reacción del brochal sobre la viga del pórtico (z = 0), por hipótesis, como una carga
    R con excentricidad Δx respecto al eje del brochal.

    Brochal biapoyado en z = 0 y z = L (regla de la palanca). Las placas apoyan en su tacón,
    a ±e del eje, así que  Δx = e · (R(+x) − R(−x)) / R.  El peso propio va centrado (Δx = 0)."""
    out = {}
    for k in COMPONENTES:
        r = {"xpos": 0.0, "xneg": 0.0, "peso": peso_propio * L / 2 if k == "PP" else 0.0}
        for lado in ("xpos", "xneg"):
            p = panos[lado]
            if L <= 0 or not p["tramos"]:
                continue
            q = _w_pano(p, k, peso_placa, grupos) * p["aportacion"]  # kN/m a lo largo del brochal
            for t in p["tramos"]:
                zi, zf = max(0.0, t["xi"]), min(L, t["xf"])
                if zf > zi:
                    r[lado] += q * (zf - zi) * (L - (zi + zf) / 2) / L
        R = r["xpos"] + r["xneg"] + r["peso"]
        r["R"] = R
        r["dx"] = e * (r["xpos"] - r["xneg"]) / R if R > TOL else 0.0
        out[k] = r
    return out


# ---------------------------------------------------------------- tipos de planta

def rotulas_tipicas_posibles(pilares):
    """Rótulas típicas: a 1,20 m de cada pilar, solo hacia dentro (hacia fuera serían mecanismo).
    La clave usa la fila del pilar en la pestaña Pilares («2:izq», «2:der»)."""
    posibles = []
    n = len(pilares)
    for k, p in enumerate(pilares):
        if k > 0:
            posibles.append({"clave": f"{p['indice']}:izq", "pilar": p["nombre"], "lado": "izq", "x": p["x"] - DIST_ROTULA_TIPICA})
        if k < n - 1:
            posibles.append({"clave": f"{p['indice']}:der", "pilar": p["nombre"], "lado": "der", "x": p["x"] + DIST_ROTULA_TIPICA})
    return posibles


def _tipo_planta_vacio(x_pilares):
    return {
        "canto": None, "color": None, "placa": None, "peso_placa": 0.0, "peso_viga": 0.0, "excentricidad": E_TACON,
        "x_min": x_pilares[0], "x_max": x_pilares[-1], "voladizos": {"inicio": 0.0, "fin": 0.0},
        "rotulas": [], "rotulas_x": [], "estabilidad": None,
        "panos": {l: {"modo": "sin", "tramos": [], "longitud_placa": 0.0, "aportacion": 0.0, "carga": None, "w": {}}
                  for l, _, _ in LADOS_VIGA},
        "lineales": [], "puntuales": [], "brochales": [], "cargas_usadas": [],
        "totales": {k: 0.0 for k in COMPONENTES}, "torsor_total": {k: 0.0 for k in COMPONENTES},
    }


def _signo_lado(lado):
    return 1.0 if lado == "zpos" else -1.0


def _rectangulos_brochal(br, b):
    """Zonas de placa del brochal en planta, como (x1, x2, d1, d2): x de la viga y distancia d
    al eje de la viga (hacia el lado del brochal). Las placas empiezan en la cara del brochal
    (a 0,35 de su eje) y miden su longitud de placa. Su +x local va con la x de la viga si
    está a z+; a z−, al revés."""
    s = _signo_lado(br["lado"])
    rects = []
    for lado_b, signo_b in (("xpos", 1.0), ("xneg", -1.0)):
        p = b["panos"][lado_b]
        if not p["tramos"]:
            continue
        x_cara = br["x"] + s * signo_b * SEMIANCHO
        x_lejos = x_cara + s * signo_b * p["longitud_placa"]
        for t in p["tramos"]:
            rects.append((min(x_cara, x_lejos), max(x_cara, x_lejos), t["xi"], t["xf"]))
    return rects


def _rectangulos_viga(pano):
    """Zonas de placa de un paño de la viga: de la cara de la viga (0,35) a la longitud de placa."""
    return [(t["xi"], t["xf"], SEMIANCHO, SEMIANCHO + pano["longitud_placa"]) for t in pano["tramos"]]


def _solape(a, b):
    """Área en común (en planta) de dos rectángulos (x1, x2, d1, d2); 0 si solo se tocan."""
    dx = min(a[1], b[1]) - max(a[0], b[0])
    dd = min(a[3], b[3]) - max(a[2], b[2])
    return dx * dd if dx > TOL and dd > TOL else 0.0


def _comprobar_solapes(brochales_planta, panos_viga, aviso, donde):
    """En planta no puede haber dos forjados en el mismo sitio:
      · placas de un brochal sobre las de un paño de la viga → error (van en direcciones distintas);
      · placas de dos brochales en la misma franja exacta (las mismas placas apoyando en los dos)
        → aviso; si se solapan de otra forma → error."""
    for br in brochales_planta:
        rv = _rectangulos_viga(panos_viga[br["lado"]])
        if any(_solape(r, v) for r in br["rectangulos"] for v in rv):
            aviso("error", f"Brochal «{br['brochal']}» en x = {_fmt(br['x'])} m: sus placas se superponen "
                           f"con las del paño {'z+' if br['lado'] == 'zpos' else 'z−'} de la viga", donde)
    for i, a in enumerate(brochales_planta):
        for b in brochales_planta[i + 1:]:
            if a["lado"] != b["lado"]:
                continue
            for ra in a["rectangulos"]:
                for rb in b["rectangulos"]:
                    if not _solape(ra, rb):
                        continue
                    misma_franja = abs(ra[0] - rb[0]) < 0.01 and abs(ra[1] - rb[1]) < 0.01
                    que = f"Brochales «{a['brochal']}» (x = {_fmt(a['x'])}) y «{b['brochal']}» (x = {_fmt(b['x'])})"
                    if misma_franja:
                        aviso("aviso", f"{que} comparten las mismas placas (apoyan en los dos): compruébalo", donde)
                    else:
                        aviso("error", f"{que}: sus placas se superponen con distinta longitud o posición", donde)


def _tipo_planta(nombre, tp, ctx, aviso):
    donde = f"Tipos de planta · {nombre}"
    x_pilares, grupos = ctx["x_pilares"], ctx["grupos"]
    out = _tipo_planta_vacio(x_pilares)

    # ---- canto: viga y placa del catálogo ----
    canto = str(tp.get("canto") or "")
    dc = CATALOGO["cantos"].get(canto)
    if dc is None:
        aviso("error", f"Canto no válido ({tp.get('canto')!r})", donde)
        dc = {"peso_viga": 0.0, "placa": None, "color": None}
    peso_placa = CATALOGO["placas"][dc["placa"]]["peso"] if dc["placa"] else 0.0
    out.update(canto=canto, color=dc["color"], placa=dc["placa"], peso_placa=peso_placa, peso_viga=dc["peso_viga"])

    # ---- voladizos: la viga se prolonga más allá del primer / último pilar ----
    vol = tp.get("voladizos") or {}
    for extremo in ("inicio", "fin"):
        v = vol.get(extremo) or {}
        if not v.get("activo"):
            continue
        lv = num(v.get("longitud"))
        if lv is None or lv <= 0:
            aviso("error", f"Voladizo {extremo}: falta la longitud (o no es válida)", donde)
            continue
        out["voladizos"][extremo] = lv
    x_min = x_pilares[0] - out["voladizos"]["inicio"]
    x_max = x_pilares[-1] + out["voladizos"]["fin"]
    out["x_min"], out["x_max"] = x_min, x_max
    longitud_viga = x_max - x_min

    def en_viga(x, que, d):
        if x < x_min - TOL or x > x_max + TOL:
            aviso("error", f"{que}: x = {_fmt(x)} m fuera de la viga ({_fmt(x_min)} a {_fmt(x_max)} m)", d)
            return False
        return True

    # ---- rótulas: típicas (a 1,20 m de los pilares) y a mano ----
    posibles = {r["clave"]: r for r in rotulas_tipicas_posibles(ctx["pilares"])}
    rotulas = []
    extremos = {}  # rótulas típicas de los pilares extremos: solo con voladizo en ese lado
    if ctx["pilares"]:
        extremos = {f"{ctx['pilares'][0]['indice']}:der": "inicio", f"{ctx['pilares'][-1]['indice']}:izq": "fin"}
    for clave in tp.get("rotulas_tipicas") or []:
        r = posibles.get(clave)
        if r is None:
            continue  # el pilar ya no existe (se borró o se cambió la lista): se ignora
        if clave in extremos and not out["voladizos"][extremos[clave]] > 0:
            aviso("aviso", f"Rótula típica junto a {r['pilar']} sin voladizo en ese extremo: el vano extremo "
                           f"ya está articulado (sobra o falta el voladizo)", donde)
        rotulas.append({"x": r["x"], "origen": "típica", "etiqueta": f"{r['pilar']} {'←' if r['lado'] == 'izq' else '→'}"})
    for j, rm in enumerate(tp.get("rotulas_mano") or []):
        if es_vacio(rm.get("x")):
            continue
        x = num(rm.get("x"))
        if x is None:
            aviso("error", f"Rótula a mano {j + 1}: x no es un número ({rm.get('x')!r})", donde)
            continue
        if not en_viga(x, f"Rótula a mano {j + 1}", donde):
            continue
        if any(abs(x - xp) < 0.05 for xp in x_pilares):
            aviso("aviso", f"Rótula a mano en x = {_fmt(x)} m coincide con un pilar", donde)
        rotulas.append({"x": x, "origen": "a mano", "etiqueta": f"x = {_fmt(x)}"})
    xs = sorted(r["x"] for r in rotulas)
    for a, b in zip(xs, xs[1:]):
        if b - a < 0.01:
            aviso("aviso", f"Rótulas repetidas en x = {_fmt(a)} m", donde)
    out["rotulas"] = sorted(rotulas, key=lambda r: r["x"])
    out["rotulas_x"] = xs

    # ---- estabilidad de la viga: los pilares interiores empotran la viga; los extremos solo
    #      si hay voladizo en ese lado (si no, el vano extremo se considera articulado) ----
    if len(x_pilares) >= 2:
        empotrados = [True] * len(x_pilares)
        empotrados[0] = out["voladizos"]["inicio"] > 0
        empotrados[-1] = out["voladizos"]["fin"] > 0
        est = estabilidad_viga(x_pilares, xs, x_min, x_max, empotrados)
        out["estabilidad"] = est
        if est["estado"] == "mecanismo":
            aviso("error", f"La viga es un mecanismo ({est['mecanismos']} grado(s) de libertad): revisa las rótulas", donde)

    usadas = {}  # nombre de carga → desfase de su CM

    # ---- paños: placas a cada lado del tacón ----
    for lado, etiqueta, signo in LADOS_VIGA:
        p = _pano((tp.get("panos") or {}).get(lado), x_min, x_max, grupos, aviso, f"{donde} · paño {etiqueta}")
        p["w"] = {k: _w_pano(p, k, peso_placa, grupos) for k in COMPONENTES}
        p["q"] = {k: p["w"][k] * p["aportacion"] for k in COMPONENTES}  # kN/m sobre la viga
        p["rectangulos"] = _rectangulos_viga(p)  # en planta, para dibujar
        if p["carga"]:
            usadas[p["carga"]] = grupos[p["carga"]]["desfase_CM"]
        out["panos"][lado] = p
        for t in p["tramos"]:
            for k in COMPONENTES:
                out["totales"][k] += p["q"][k] * (t["xf"] - t["xi"])
                out["torsor_total"][k] += signo * E_TACON * p["q"][k] * (t["xf"] - t["xi"])
    out["totales"]["PP"] += out["peso_viga"] * longitud_viga

    # ---- cargas lineales y puntuales colocadas ----
    def excentricidad(c, d):
        e = num(c.get("e"))
        if e is None:
            if not es_vacio(c.get("e")):
                aviso("error", f"Excentricidad no válida ({c.get('e')!r})", d)
            e = 0.0
        if e < 0:
            aviso("error", "Excentricidad negativa: indica el lado con z+ / z−", d)
            e = abs(e)
        lado = c.get("lado") if c.get("lado") in ("zpos", "zneg") else "zpos"
        return e, lado

    for j, c in enumerate(tp.get("lineales") or []):
        d = f"{donde} · carga lineal {j + 1}"
        lib = ctx["lineales"].get(c.get("carga"))
        if lib is None:
            aviso("error", f"Carga lineal no válida ({c.get('carga')!r})", d)
            continue
        x0, xf = num(c.get("x0")), num(c.get("xf"))
        if x0 is None or xf is None or xf <= x0:
            aviso("error", "Falta x inicial / final o la final no es mayor", d)
            continue
        if not (en_viga(x0, "Inicio", d) and en_viga(xf, "Fin", d)):
            continue
        e, lado = excentricidad(c, d)
        s = _signo_lado(lado)
        w = {k: lib[k] for k in COMPONENTES}
        out["lineales"].append({"x0": x0, "xf": xf, "carga": lib["nombre"], "e": e, "lado": lado,
                                "w": w, "mt": {k: w[k] * e * s for k in COMPONENTES}})
        usadas[lib["nombre"]] = lib["desfase_CM"]
        for k in COMPONENTES:
            out["totales"][k] += w[k] * (xf - x0)
            out["torsor_total"][k] += w[k] * e * s * (xf - x0)

    for j, c in enumerate(tp.get("puntuales") or []):
        d = f"{donde} · carga puntual {j + 1}"
        lib = ctx["puntuales"].get(c.get("carga"))
        if lib is None:
            aviso("error", f"Carga puntual no válida ({c.get('carga')!r})", d)
            continue
        x = num(c.get("x"))
        if x is None or not en_viga(x, "Carga puntual", d):
            if x is None:
                aviso("error", "Falta la posición x", d)
            continue
        e, lado = excentricidad(c, d)
        s = _signo_lado(lado)
        P = {k: lib[k] for k in COMPONENTES}
        out["puntuales"].append({"x": x, "carga": lib["nombre"], "e": e, "lado": lado,
                                 "P": P, "mt": {k: P[k] * e * s for k in COMPONENTES}})
        usadas[lib["nombre"]] = lib["desfase_CM"]
        for k in COMPONENTES:
            out["totales"][k] += P[k]
            out["torsor_total"][k] += P[k] * e * s

    # ---- brochales insertados: carga puntual R en x ± Δx, sobre el tacón ----
    for j, c in enumerate(tp.get("brochales") or []):
        d = f"{donde} · brochal {j + 1}"
        b = ctx["brochales"].get(c.get("brochal"))
        if b is None:
            aviso("error", f"Brochal no válido ({c.get('brochal')!r})", d)
            continue
        x = num(c.get("x"))
        if x is None:
            aviso("error", "Falta la posición x", d)
            continue
        if not en_viga(x, "Brochal", d):
            continue
        lado = c.get("lado") if c.get("lado") in ("zpos", "zneg") else "zpos"
        s = _signo_lado(lado)
        rea = b["reacciones"]
        # el brochal hacia z+ tiene su +x en el sentido de la x de la viga; hacia z−, al revés
        x_carga = {k: x + s * rea[k]["dx"] for k in COMPONENTES}
        out["brochales"].append({"x": x, "brochal": b["nombre"], "lado": lado,
                                 "R": {k: rea[k]["R"] for k in COMPONENTES},
                                 "dx": {k: rea[k]["dx"] for k in COMPONENTES},
                                 "x_carga": x_carga,
                                 "mt": {k: rea[k]["R"] * E_TACON * s for k in COMPONENTES},
                                 "luz": b["luz"]})
        out["brochales"][-1]["rectangulos"] = _rectangulos_brochal(out["brochales"][-1], b)  # para dibujar
        for carga in b["cargas_usadas"]:
            usadas[carga] = grupos[carga]["desfase_CM"]
        for k in COMPONENTES:
            out["totales"][k] += rea[k]["R"]
            out["torsor_total"][k] += rea[k]["R"] * E_TACON * s

    _comprobar_solapes(out["brochales"], out["panos"], aviso, donde)
    out["semiancho_viga"] = SEMIANCHO

    out["cargas_usadas"] = sorted(usadas.items())
    return out
