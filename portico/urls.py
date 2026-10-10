from django.urls import path

from . import views

urlpatterns = [
    path("", views.lista, name="lista"),
    path("proyecto/<int:pk>/", views.editor, name="editor"),
    path("proyecto/<int:pk>/duplicar/", views.duplicar, name="duplicar"),
    path("proyecto/<int:pk>/eliminar/", views.eliminar, name="eliminar"),
    path("proyecto/<int:pk>/exportar/", views.exportar, name="exportar"),
    path("importar/", views.importar, name="importar"),
    path("api/proyecto/<int:pk>/guardar/", views.api_guardar, name="api_guardar"),
    path("api/interpretar/", views.api_interpretar, name="api_interpretar"),
]
