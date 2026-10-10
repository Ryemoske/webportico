# Pórticos SEI · prototipo de entrada de datos

Prototipo para probar con usuarios la **entrada de datos** de pórticos con construcción
evolutiva. Todavía no calcula: interpreta los datos (fases, cargas por metro, torsores,
avisos) y dibuja el alzado.

## Arrancar

Desde `C:\_WEBPORTICO`:

```powershell
.venv\Scripts\Activate.ps1
python manage.py runserver
```

Abrir http://127.0.0.1:8000

### Para que otros lo usen desde la red de la oficina (prueba con usuarios)

```powershell
python manage.py runserver 0.0.0.0:8000
```

Los compañeros entran con `http://<nombre-o-IP-de-tu-PC>:8000` (la IP sale con `ipconfig`).
Puede que el cortafuegos de Windows pida permiso para Python la primera vez.
Solo para pruebas en la red interna: es el servidor de desarrollo de Django.

## Estructura

```
config/                 ajustes de Django
portico/
  interpretacion.py     lógica: grupos, valores por defecto, fases, cargas y torsores, avisos
  models.py             Proyecto (el JSON del proyecto se guarda tal cual)
  views.py / urls.py    páginas y API (guardar, interpretar)
  templates/portico/    lista de proyectos y editor
  static/portico/       editor.js (tablas, dibujo, autoguardado) y estilo.css
  tests.py              pruebas de la lógica
```

Pruebas: `python manage.py test portico`

## Reglas que aplica

- Tipos de forjado (viga + placa del catálogo) → PP; grupos de cargas → CM, SC y desfase de la CM
- Tipo de planta = forjado + rótulas + cargas uniformes; cada nivel elige su tipo de planta
- q por lado = carga (kN/m²) × aportación (m, ancho tributario, sin dividir) · torsor mt = (q z+ − q z−) × excentricidad del tacón
- Peso propio de la viga en toda su longitud, según el forjado
- Fases: PP del nivel n en la fase n · CM con el desfase de su grupo (fase n + desfase, o la última) · SC al final
- Renombrar un forjado, grupo o tipo de planta lo renombra donde se usa; eliminarlo avisa
- Los proyectos con el formato anterior se convierten solos al abrirlos (`migrar` en interpretacion.py)
- Se admite coma decimal

## Protocolo de prueba con usuarios

1. Edificio real ya calculado, que el usuario no conozca.
2. Tú a su lado **sin ayudar**, salvo bloqueo total. Anota cada intervención: es un fallo de la interfaz.
3. Que piense en voz alta.
4. Cronometra y compara con el método actual.
5. Al final: ¿qué te ha costado más? ¿Lo usarías?
6. Corrige y repite con otra persona.
