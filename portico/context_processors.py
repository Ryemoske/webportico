from pathlib import Path

ESTATICOS = Path(__file__).parent / "static"


def version_estaticos(request):
    """Versión de los CSS/JS = fecha de modificación más reciente. Se añade a sus URLs
    (?v=…) para que el navegador no use una copia antigua de su caché tras un cambio."""
    fechas = [f.stat().st_mtime for f in ESTATICOS.rglob("*") if f.is_file()]
    return {"VERSION_ESTATICOS": int(max(fechas, default=0))}
