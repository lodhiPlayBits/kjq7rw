# Reproducible local/reviewer environment: one image serving the React build and the API on :8000.
# (Production hosting is Vercel; see README.)

# --- build the frontend ---
FROM node:22.16.0-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- runtime ---
FROM python:3.12.10-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/windsight backend/windsight
COPY data/*.csv.gz data/
COPY --from=web /web/dist web/dist
RUN useradd --system --no-create-home windsight
USER windsight
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"
CMD ["uvicorn", "windsight.app:app", "--host", "0.0.0.0", "--port", "8000"]
