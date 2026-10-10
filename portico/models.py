from django.db import models

from .interpretacion import proyecto_nuevo


class Proyecto(models.Model):
    nombre = models.CharField(max_length=200)
    # JSON del proyecto tal como lo edita el usuario (compacto: grupos, por defecto…)
    datos = models.JSONField(default=proyecto_nuevo)
    creado = models.DateTimeField(auto_now_add=True)
    modificado = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-modificado"]

    def __str__(self):
        return self.nombre
