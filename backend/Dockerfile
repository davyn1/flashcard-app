FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app
COPY scripts ./scripts

RUN useradd --create-home appuser
USER appuser

ENV PORT=8000
EXPOSE 8000
# Apply migrations, then serve. Hosts like Render/Fly/Railway inject $PORT.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.asgi:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips=*"]
