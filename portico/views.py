import json

from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST

from .interpretacion import CATALOGO, interpretar, migrar, proyecto_nuevo
from .models import Proyecto


def lista(request):
    if request.method == "POST":
        nombre = request.POST.get("nombre", "").strip() or "Proyecto sin nombre"
        p = Proyecto.objects.create(nombre=nombre, datos=proyecto_nuevo())
        return redirect("editor", pk=p.pk)
    return render(request, "portico/lista.html", {"proyectos": Proyecto.objects.all()})


@ensure_csrf_cookie
def editor(request, pk):
    p = get_object_or_404(Proyecto, pk=pk)
    datos = migrar(p.datos)  # proyectos guardados con formatos anteriores
    return render(request, "portico/editor.html", {"proyecto": p, "datos": datos, "catalogo": CATALOGO})


@require_POST
def duplicar(request, pk):
    p = get_object_or_404(Proyecto, pk=pk)
    copia = Proyecto.objects.create(nombre=f"{p.nombre} (copia)", datos=p.datos)
    return redirect("editor", pk=copia.pk)


@require_POST
def eliminar(request, pk):
    get_object_or_404(Proyecto, pk=pk).delete()
    return redirect("lista")


def exportar(request, pk):
    p = get_object_or_404(Proyecto, pk=pk)
    contenido = json.dumps({"nombre": p.nombre, "datos": p.datos}, ensure_ascii=False, indent=2)
    resp = HttpResponse(contenido, content_type="application/json; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{p.nombre}.json"'
    return resp


@require_POST
def importar(request):
    f = request.FILES.get("archivo")
    if not f:
        return HttpResponseBadRequest("Falta el archivo")
    try:
        contenido = json.loads(f.read().decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return HttpResponseBadRequest("El archivo no es un JSON válido")
    datos = contenido.get("datos", contenido)
    nombre = contenido.get("nombre") or f.name.rsplit(".", 1)[0]
    p = Proyecto.objects.create(nombre=nombre, datos=datos)
    return redirect("editor", pk=p.pk)


def _leer_json(request):
    try:
        return json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


@require_POST
def api_guardar(request, pk):
    p = get_object_or_404(Proyecto, pk=pk)
    cuerpo = _leer_json(request)
    if not isinstance(cuerpo, dict) or not isinstance(cuerpo.get("datos"), dict):
        return JsonResponse({"ok": False, "error": "Datos no válidos"}, status=400)
    p.datos = cuerpo["datos"]
    if cuerpo.get("nombre", "").strip():
        p.nombre = cuerpo["nombre"].strip()
    p.save()
    return JsonResponse({"ok": True, "creado": p.creado.isoformat(), "modificado": p.modificado.isoformat()})


@require_POST
def api_interpretar(request):
    datos = _leer_json(request)
    if not isinstance(datos, dict):
        return JsonResponse({"error": "Datos no válidos"}, status=400)
    return JsonResponse(interpretar(datos))
