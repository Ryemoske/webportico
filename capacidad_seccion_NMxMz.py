"""
Capacidad última de una sección de hormigón armado en flexión esviada (N, Mx, Mz)
con OpenSeesPy y los dominios de deformación del EC2 (6.1).

Ejes    : el pilar va según Y; la sección está en el plano X-Z.
Unidades: kN, m, kPa
Signos  : N < 0 compresión; deformaciones > 0 tracción.

Resultado: factor de carga lambda.
  MODO = 'proporcional' -> se escalan N, Mx y Mz a la vez (lambda * acciones)
  MODO = 'N_constante'  -> N fijo, se escalan Mx y Mz manteniendo su proporción
  La sección CUMPLE si lambda >= 1.
"""
import openseespy.opensees as ops

# =========================== DATOS ===========================
b, h = 0.40, 0.60                     # canto según X y según Z (m)
fck, gc, acc = 30e3, 1.5, 1.0         # kPa
fyk, gs, Es = 500e3, 1.15, 200e6      # kPa
ec2, ecu2, eud = 0.002, 0.0035, 0.010 # EC2 (fck <= 50) y límite del acero

rec = 0.05                            # recubrimiento mecánico (al eje de la barra)
A20 = 3.1416e-4                       # área de una barra de Ø20
xb, zb = b/2 - rec, h/2 - rec
barras = [                            # (x, z, área) -> 10Ø20
    (-xb,  zb, A20), (0.0,  zb, A20), (xb,  zb, A20),
    (-xb, -zb, A20), (0.0, -zb, A20), (xb, -zb, A20),
    (-xb,  zb/3, A20), (xb,  zb/3, A20),
    (-xb, -zb/3, A20), (xb, -zb/3, A20),
]

NEd, MxEd, MzEd = -1500.0, 120.0, 80.0   # acciones de cálculo (kN, kN·m)
MODO = 'proporcional'                    # 'proporcional' o 'N_constante'

nfx, nfz = 40, 60                     # fibras de hormigón según X y Z
NPASOS = 40                           # incrementos por ensayo
# =============================================================

fcd, fyd = acc * fck / gc, fyk / gs


def construir():
    ops.wipe()
    ops.model('basic', '-ndm', 3, '-ndf', 6)
    # Parábola-rectángulo exacta: Concrete01 = parábola hasta ec2, meseta fcd hasta ecu2
    ops.uniaxialMaterial('Concrete01', 1, -fcd, -ec2, -fcd, -ecu2)
    ops.uniaxialMaterial('Steel01', 2, fyd, Es, 0.0)   # elastoplástico perfecto
    # Fibras: y_seccion = X, z_seccion = Z
    ops.section('Fiber', 1, '-GJ', 1.0e10)
    ops.patch('rect', 1, nfx, nfz, -b/2, -h/2, b/2, h/2)
    for x, z, A in barras:
        ops.fiber(x, z, A, 2)
        ops.fiber(x, z, -A, 1)                          # descuenta el hormigón desplazado
    # Elemento de longitud nula: x local = eje del pilar
    ops.node(1, 0.0, 0.0, 0.0)
    ops.node(2, 0.0, 0.0, 0.0)
    ops.fix(1, 1, 1, 1, 1, 1, 1)
    ops.fix(2, 0, 1, 1, 1, 0, 0)                        # libres: axil, giro según y (Mx) y según z (Mz)
    ops.element('zeroLengthSection', 1, 1, 2, 1)


def preparar(dlam):
    ops.wipeAnalysis()
    ops.constraints('Plain'); ops.numberer('Plain'); ops.system('BandGeneral')
    ops.test('NormDispIncr', 1e-10, 100); ops.algorithm('Newton')
    ops.integrator('LoadControl', dlam); ops.analysis('Static')


def eps_fibra(x, z, mat):
    return ops.eleResponse(1, 'section', 'fiber', x, z, mat, 'stressStrain')[1]


def comprobar():
    """Dominios de deformación del EC2. Devuelve (ok, motivo, deformaciones)."""
    esq = [eps_fibra(sx * b/2, sz * h/2, 1) for sx in (-1, 1) for sz in (-1, 1)]
    a = -min(esq)                       # compresión máxima (valor positivo)
    c = -max(esq)                       # compresión mínima (< 0 si hay tracción)
    es = max(eps_fibra(x, z, 2) for x, z, _ in barras)
    d = dict(eps_c_max=-a, eps_s_max=es)
    if a > ecu2:
        return False, 'aplastamiento del hormigón (εc > εcu2)', d
    k = 1.0 - ec2 / ecu2                # 3/7 en EC2
    if c > 0 and a - k * (a - c) > ec2:
        return False, 'compresión compuesta (pivote C, εc2 a 3/7·h)', d
    if es > eud:
        return False, 'deformación del acero (εs > εud)', d
    return True, '', d


def ensayo(lam):
    """Aplica lam veces las acciones y dice si la sección lo resiste."""
    construir()
    if MODO == 'N_constante':
        ops.timeSeries('Constant', 1); ops.pattern('Plain', 1, 1)
        ops.load(2, NEd, 0, 0, 0, 0, 0)
        preparar(0.0)
        if ops.analyze(1) != 0:
            return False, 'la sección no resiste NEd', {}
        ok, motivo, d = comprobar()
        if not ok:
            return False, 'la sección no resiste NEd: ' + motivo, d
        ops.timeSeries('Linear', 2); ops.pattern('Plain', 2, 2)
        ops.load(2, 0, 0, 0, 0, MxEd, MzEd)
    else:
        ops.timeSeries('Linear', 1); ops.pattern('Plain', 1, 1)
        ops.load(2, NEd, 0, 0, 0, MxEd, MzEd)
    preparar(lam / NPASOS)
    d = {}
    for _ in range(NPASOS):
        if ops.analyze(1) != 0:
            return False, 'sin convergencia (máximo resistente de la sección)', d
        ok, motivo, d = comprobar()
        if not ok:
            return False, motivo, d
    return True, '', d


def capacidad(tol=1e-4):
    lo, hi = 0.0, 1.0
    while ensayo(hi)[0]:
        lo, hi = hi, 2 * hi
        if hi > 1e4:
            raise RuntimeError('Acciones nulas o sección sin límite: revisa los datos')
    if MODO == 'N_constante' and not ensayo(1e-6)[0]:
        raise RuntimeError(ensayo(1e-6)[1])
    while (hi - lo) > tol * max(hi, 1e-9):
        mid = 0.5 * (lo + hi)
        if ensayo(mid)[0]:
            lo = mid
        else:
            hi = mid
    motivo = ensayo(hi)[1]
    d = ensayo(lo)[2]
    return lo, motivo, d


if __name__ == '__main__':
    lam, motivo, d = capacidad()
    fN = lam if MODO == 'proporcional' else 1.0
    print(f'Modo            : {MODO}')
    print(f'Acciones        : NEd = {NEd:.1f} kN   MxEd = {MxEd:.1f} kN·m   MzEd = {MzEd:.1f} kN·m')
    print(f'Factor lambda   : {lam:.3f}   ->  {"CUMPLE" if lam >= 1 else "NO CUMPLE"}')
    print(f'Capacidad       : NRd = {fN*NEd:.1f} kN   MxRd = {lam*MxEd:.1f} kN·m   MzRd = {lam*MzEd:.1f} kN·m')
    print(f'Rotura por      : {motivo}')
    if d:
        print(f'En rotura       : εc,max = {d["eps_c_max"]*1e3:.2f} ‰   εs,max = {d["eps_s_max"]*1e3:.2f} ‰')
