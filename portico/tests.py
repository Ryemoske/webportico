from django.test import SimpleTestCase

from .interpretacion import CATALOGO, estabilidad_viga, interpretar, migrar, num, parse_rotulas

E = CATALOGO["excentricidad_tacon"]
PLACA_35 = CATALOGO["placas"][CATALOGO["cantos"]["35"]["placa"]]["peso"]
VIGA_35 = CATALOGO["cantos"]["35"]["peso_viga"]


def tipo(**cambios):
    t = {
        "nombre": "Tipo", "canto": "35",
        "voladizos": {"inicio": {"activo": False}, "fin": {"activo": False}},
        "panos": {"zpos": {"modo": "completo", "longitud_placa": 10, "carga": "Oficinas"},
                  "zneg": {"modo": "completo", "longitud_placa": 7, "carga": "Oficinas"}},
        "rotulas_tipicas": ["1:der", "2:izq"], "rotulas_mano": [],
        "lineales": [], "puntuales": [], "brochales": [],
    }
    t.update(cambios)
    return t


def proyecto(**cambios):
    p = {
        "cargas_pano": [{"nombre": "Oficinas", "CM": 2, "SC": 3, "desfase_CM": 3},
                        {"nombre": "Cubierta", "CM": 1, "SC": 1, "desfase_CM": 0}],
        "cargas_lineales": [{"nombre": "Fachada", "pp_activo": False, "CM": 6, "SC": 0},
                            {"nombre": "Muro", "pp_activo": True, "PP": 7.5, "CM": 0, "SC": 0}],
        "cargas_puntuales": [{"nombre": "Equipo", "pp_activo": False, "CM": 20, "SC": 5}],
        "pilares": {"lista": [{"nombre": "P1"}, {"nombre": "P2", "separacion": 7.5},
                              {"nombre": "P3", "separacion": 7.5}, {"nombre": "P4", "separacion": 7}]},
        "brochales": [],
        "tipos_planta": [tipo()],
        "niveles": [{"nombre": f"N{i}", "altura": 3.5, "tipo_planta": "Tipo"} for i in range(1, 5)],
    }
    p.update(cambios)
    return p


def brochal(**cambios):
    b = {"nombre": "B1", "luz": 4.8, "canto": "35", "panos": {
        "xpos": {"modo": "completo", "longitud_placa": 6, "carga": "Oficinas"},
        "xneg": {"modo": "parcial", "longitud_placa": "4,5", "carga": "Cubierta", "tramos": [{"xi": 0, "xf": 2.5}]},
    }}
    b.update(cambios)
    return b


def textos(r):
    return [a["texto"] for a in r["avisos"]]


class Numeros(SimpleTestCase):
    def test_coma_decimal(self):
        self.assertEqual(num("7,5"), 7.5)
        self.assertIsNone(num(""))
        self.assertIsNone(num("abc"))

    def test_rotulas_texto_antiguo(self):
        self.assertEqual(parse_rotulas("20,5; 9"), ([9.0, 20.5], []))


class Pilares(SimpleTestCase):
    def test_separaciones_antiguas_pasan_a_lista_con_nombres(self):
        d = migrar({"pilares": {"separaciones": [5, 6]}})
        self.assertEqual([p["nombre"] for p in d["pilares"]["lista"]], ["P1", "P2", "P3"])

    def test_posiciones_y_nombres(self):
        r = interpretar(proyecto())
        self.assertEqual(r["x_pilares"], [0.0, 7.5, 15.0, 22.0])
        self.assertEqual(r["pilares"][0]["seccion"], "30×30")

    def test_avisos_de_separacion(self):
        lista = [{"nombre": "P1"}, {"nombre": "P2", "separacion": 1.2}, {"nombre": "P2", "separacion": 0}]
        t = textos(interpretar(proyecto(pilares={"lista": lista})))
        self.assertTrue(any("poco habitual" in x for x in t))
        self.assertTrue(any("separación no válida" in x for x in t))
        self.assertTrue(any("repetido" in x for x in t))


class Estabilidad(SimpleTestCase):
    """Viga empotrada en los pilares (vertical + giro), con rótulas."""
    X = [0, 7.5, 15, 22]
    TODAS = ["0:der", "1:izq", "1:der", "2:izq", "2:der", "3:izq"]  # típicas: las 6 posibles

    def test_continua_y_con_todas_las_tipicas(self):
        self.assertEqual(estabilidad_viga(self.X, [], 0, 22)["gh"], 6)
        x = [1.2, 6.3, 8.7, 13.8, 16.2, 20.8]
        self.assertEqual(estabilidad_viga(self.X, x, 0, 22)["estado"], "isostatica")

    def test_mecanismos(self):
        self.assertEqual(estabilidad_viga(self.X, [8.7, 10, 13.8], 0, 22)["estado"], "mecanismo")  # 3 en un vano
        self.assertEqual(estabilidad_viga(self.X, [-0.5], -1.5, 22)["estado"], "mecanismo")        # en voladizo
        self.assertEqual(estabilidad_viga([0, 6], [1.2, 3, 4.8], 0, 6)["estado"], "mecanismo")

    INTERIORES = ["1:izq", "1:der", "2:izq", "2:der"]

    def test_vanos_extremos_articulados_sin_voladizo(self):
        # pilares extremos articulados + típicas de los interiores → isostática
        tp = interpretar(proyecto(tipos_planta=[tipo(rotulas_tipicas=self.INTERIORES)]))["tipos_planta"]["Tipo"]
        self.assertEqual(len(tp["rotulas"]), 4)
        self.assertAlmostEqual(tp["rotulas"][0]["x"], 7.5 - 1.2)
        self.assertEqual(tp["estabilidad"]["estado"], "isostatica")
        # sin rótulas: 7 reacciones (V y H en P1, V en P4, V y M en P2 y P3) − 3 ecuaciones → GH = 4
        tp = interpretar(proyecto(tipos_planta=[tipo(rotulas_tipicas=[])]))["tipos_planta"]["Tipo"]
        self.assertEqual(tp["estabilidad"]["gh"], 4)

    def test_tipica_en_extremo_sin_voladizo_es_mecanismo_y_avisa(self):
        r = interpretar(proyecto(tipos_planta=[tipo(rotulas_tipicas=self.TODAS)]))
        self.assertEqual(r["tipos_planta"]["Tipo"]["estabilidad"]["estado"], "mecanismo")
        self.assertTrue(any("sin voladizo" in x for x in textos(r)))

    def test_voladizo_empotra_el_pilar_extremo(self):
        vol = {"inicio": {"activo": True, "longitud": 1.5}, "fin": {"activo": False}}
        r = interpretar(proyecto(tipos_planta=[tipo(voladizos=vol, rotulas_tipicas=["0:der"] + self.INTERIORES)]))
        self.assertEqual(r["tipos_planta"]["Tipo"]["estabilidad"]["estado"], "isostatica")
        self.assertFalse(any("sin voladizo" in x for x in textos(r)))

    def test_mecanismo_avisa_error(self):
        p = proyecto(tipos_planta=[tipo(rotulas_tipicas=[], rotulas_mano=[{"x": 8.7}, {"x": 10}, {"x": 13.8}])])
        self.assertTrue(any("mecanismo" in x for x in textos(interpretar(p))))


class Planta(SimpleTestCase):
    def test_canto_y_panos(self):
        tp = interpretar(proyecto())["tipos_planta"]["Tipo"]
        self.assertEqual((tp["placa"], tp["peso_viga"]), ("PA20", VIGA_35))
        zp = tp["panos"]["zpos"]
        self.assertEqual(zp["aportacion"], 5)                      # la mitad de la placa
        self.assertAlmostEqual(zp["q"]["PP"], PLACA_35 * 5)
        self.assertAlmostEqual(zp["q"]["SC"], 3 * 5)
        self.assertEqual(zp["tramos"], [{"xi": 0.0, "xf": 22.0}])

    def test_totales_y_torsor(self):
        tp = interpretar(proyecto())["tipos_planta"]["Tipo"]
        self.assertAlmostEqual(tp["totales"]["PP"], PLACA_35 * (5 + 3.5) * 22 + VIGA_35 * 22)
        self.assertAlmostEqual(tp["torsor_total"]["CM"], E * 2 * (5 - 3.5) * 22)

    def test_voladizos_amplian_la_viga(self):
        p = proyecto(tipos_planta=[tipo(voladizos={"inicio": {"activo": True, "longitud": "1,5"}, "fin": {"activo": False}})])
        tp = interpretar(p)["tipos_planta"]["Tipo"]
        self.assertEqual((tp["x_min"], tp["x_max"]), (-1.5, 22.0))
        self.assertEqual(tp["panos"]["zpos"]["tramos"], [{"xi": -1.5, "xf": 22.0}])

    def test_lineales_y_puntuales(self):
        p = proyecto(tipos_planta=[tipo(
            lineales=[{"x0": 0, "xf": 22, "carga": "Fachada", "e": 0.3, "lado": "zneg"}],
            puntuales=[{"x": 11, "carga": "Equipo", "e": 0, "lado": "zpos"}])])
        tp = interpretar(p)["tipos_planta"]["Tipo"]
        self.assertAlmostEqual(tp["lineales"][0]["mt"]["CM"], -6 * 0.3)
        self.assertEqual(tp["puntuales"][0]["mt"]["CM"], 0)        # en eje: sin torsor
        nombres = [c for c, _ in tp["cargas_usadas"]]
        self.assertIn("Fachada", nombres)
        self.assertIn("Equipo", nombres)

    def test_fases_con_desfase(self):
        fases = interpretar(proyecto())["fases"]
        self.assertEqual(fases[0]["entra"], ["PP · N1"])
        self.assertIn("CM Oficinas · N1", fases[3]["entra"])
        self.assertEqual(fases[-1]["fase"], "Final")

    def test_avisos_de_entrada(self):
        p = proyecto(tipos_planta=[tipo(canto="50", rotulas_mano=[{"x": 40}],
                                        lineales=[{"x0": 0, "xf": 5, "carga": "no_existe"}])])
        p["niveles"][1]["tipo_planta"] = "no_existe"
        t = textos(interpretar(p))
        self.assertTrue(any("Canto no válido" in x for x in t))
        self.assertTrue(any("fuera de la viga" in x for x in t))
        self.assertTrue(any("Carga lineal no válida" in x for x in t))
        self.assertTrue(any("Sin tipo de planta válido" in x for x in t))


class Brochales(SimpleTestCase):
    def test_reaccion_y_excentricidad(self):
        r = interpretar(proyecto(brochales=[brochal()]))["brochales"]["B1"]["reacciones"]
        L = 4.8
        r_pos = PLACA_35 * 3 * L / 2
        r_neg = PLACA_35 * 2.25 * 2.5 * (L - 1.25) / L
        R = r_pos + r_neg + VIGA_35 * L / 2
        self.assertAlmostEqual(r["PP"]["R"], R)
        self.assertAlmostEqual(r["PP"]["dx"], E * (r_pos - r_neg) / R)

    def test_insertado_en_la_planta(self):
        p = proyecto(brochales=[brochal()], tipos_planta=[tipo(
            panos={"zpos": {"modo": "sin"}, "zneg": {"modo": "completo", "longitud_placa": 7, "carga": "Oficinas"}},
            brochales=[{"x": 11, "brochal": "B1", "lado": "zpos"}])])
        r = interpretar(p)
        tp, rea = r["tipos_planta"]["Tipo"], r["brochales"]["B1"]["reacciones"]
        br = tp["brochales"][0]
        self.assertAlmostEqual(br["x_carga"]["PP"], 11 + rea["PP"]["dx"])     # a z+: +x local = +x global
        self.assertAlmostEqual(br["mt"]["PP"], rea["PP"]["R"] * E)
        self.assertNotIn("superponen", " ".join(textos(r)))

    def test_placas_empiezan_en_la_cara(self):
        p = proyecto(brochales=[brochal()], tipos_planta=[tipo(
            panos={"zpos": {"modo": "sin"}, "zneg": {"modo": "sin"}},
            brochales=[{"x": 11, "brochal": "B1", "lado": "zpos"}])])
        rects = interpretar(p)["tipos_planta"]["Tipo"]["brochales"][0]["rectangulos"]
        self.assertIn((11.35, 17.35, 0.0, 4.8), rects)              # +x: de la cara (0,35) a 6 m más
        self.assertIn((6.15, 10.65, 0.0, 2.5), rects)               # −x parcial 0–2,5: de 10,65 a 4,5 m menos

    def test_dos_brochales_misma_franja_es_aviso(self):
        # B1 en x = 5 con placas de 6 m a +x; B2 en x = 5 + 0,35 + 6 + 0,35 = 11,7 con 6 m a −x
        b2 = brochal(nombre="B2", panos={"xpos": {"modo": "sin"},
                                         "xneg": {"modo": "completo", "longitud_placa": 6, "carga": "Oficinas"}})
        b1 = brochal(panos={"xpos": {"modo": "completo", "longitud_placa": 6, "carga": "Oficinas"}, "xneg": {"modo": "sin"}})
        sin = {"zpos": {"modo": "sin"}, "zneg": {"modo": "sin"}}
        p = proyecto(brochales=[b1, b2], tipos_planta=[tipo(panos=sin, brochales=[
            {"x": 5, "brochal": "B1", "lado": "zpos"}, {"x": 11.7, "brochal": "B2", "lado": "zpos"}])])
        r = interpretar(p)
        self.assertTrue(any("comparten las mismas placas" in x for x in textos(r)))
        self.assertFalse(any(a["gravedad"] == "error" for a in r["avisos"]))
        # si B2 se acerca, la franja ya no es la misma → error
        p["tipos_planta"][0]["brochales"][1]["x"] = 10
        self.assertTrue(any("distinta longitud o posición" in x for x in textos(interpretar(p))))

    def test_placas_superpuestas_es_error(self):
        p = proyecto(brochales=[brochal()], tipos_planta=[tipo(brochales=[{"x": 11, "brochal": "B1", "lado": "zpos"}])])
        self.assertTrue(any("superponen" in x for x in textos(interpretar(p))))


class CargasEspeciales(SimpleTestCase):
    def test_pp_solo_si_esta_activado(self):
        lin = {c["nombre"]: c for c in interpretar(proyecto())["cargas_lineales"]}
        self.assertEqual(lin["Muro"]["PP"], 7.5)
        self.assertEqual(lin["Fachada"]["PP"], 0.0)


class Migracion(SimpleTestCase):
    ANTIGUO = {
        "pilares": {"separaciones": [9, 9]},
        "grupos": {"tipo": {"cargas_superficiales": [{"inicio": 0, "fin": 18, "luz_placa_zpos": 10, "luz_placa_zneg": 7}]}},
        "tipos_forjado": [{"nombre": "F1", "viga": "V30", "placa": "PA20"}, {"nombre": "F2", "viga": "V40", "placa": "PA25"}],
        "grupos_cargas": [{"nombre": "BAJA", "CM": 4, "SC": 3, "desfase_CM": 3}],
        "niveles": [{"nombre": "P1", "altura": 4, "rotulas": "12", "grupo": "tipo", "forjado": "F1"},
                    {"nombre": "P2", "altura": 4, "rotulas": "12", "grupo": "tipo", "forjado": "F2"}],
    }

    def test_del_formato_inicial_al_actual(self):
        d = migrar(self.ANTIGUO)
        self.assertEqual([t["nombre"] for t in d["tipos_planta"]], ["Tipo (F1)", "Tipo (F2)"])
        self.assertEqual([t["canto"] for t in d["tipos_planta"]], ["35", "40"])
        t = d["tipos_planta"][0]
        self.assertEqual(t["rotulas_mano"], [{"x": 12.0}])
        self.assertEqual((t["panos"]["zpos"]["longitud_placa"], t["panos"]["zneg"]["longitud_placa"]), (10, 7))
        self.assertEqual(t["panos"]["zpos"]["carga"], "BAJA")
        self.assertEqual(t["panos"]["zpos"]["modo"], "completo")   # el tramo cubría toda la viga (0 a 18)
        for clave in ("grupos", "grupos_cargas", "tipos_forjado", "por_defecto"):
            self.assertNotIn(clave, d)

    def test_idempotente_y_sin_errores(self):
        d = migrar(self.ANTIGUO)
        self.assertEqual(migrar(d), d)
        self.assertEqual([a for a in interpretar(self.ANTIGUO)["avisos"] if a["gravedad"] == "error"], [])
