FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# dependencias primero, para aprovechar la caché de capas
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# estáticos en la imagen (los sirve WhiteNoise); la clave solo hace falta para cargar settings
RUN DJANGO_SECRET_KEY=solo-para-collectstatic python manage.py collectstatic --noinput

# usuario sin privilegios; /app/data es donde se monta el volumen de la base de datos
RUN useradd --create-home --uid 1000 app \
    && mkdir -p /app/data \
    && chown -R app:app /app/data
USER app

EXPOSE 8000

CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
