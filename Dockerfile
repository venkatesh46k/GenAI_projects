# syntax=docker/dockerfile:1
#
# One file, three images:
#   docker build -t billing-copilot .                    the all-in-one image (Hugging Face Docker Space): the default target
#   docker build --target web -t billing-copilot-web .   Node only: billing + public web tier + the built React console
#   docker build --target ai  -t billing-copilot-ai  .   Python only: the AI service
# docker-compose.yml runs the last two as separate services.

# ---- the React console ----
FROM node:24-slim AS web-build
WORKDIR /src
# The console imports response types from the Node service, so both need their dependencies for the type check.
COPY services/billing/package*.json services/billing/
RUN cd services/billing && npm ci
COPY web/package*.json web/
RUN cd web && npm ci
COPY services/billing services/billing
COPY web web
RUN cd web && npm run build

# ---- the Node billing + web tier, compiled ----
FROM node:24-slim AS node-build
WORKDIR /app/services/billing
COPY services/billing/package*.json ./
RUN npm ci
COPY services/billing ./
RUN npm run build && npm prune --omit=dev

# ---- target "web": Node only ----
FROM node:24-slim AS web
ENV NODE_ENV=production
WORKDIR /app
COPY --from=node-build --chown=1000:1000 /app/services/billing/dist services/billing/dist
COPY --from=node-build --chown=1000:1000 /app/services/billing/node_modules services/billing/node_modules
COPY --from=node-build --chown=1000:1000 /app/services/billing/package.json services/billing/package.json
COPY --from=web-build --chown=1000:1000 /src/web/dist web/dist
COPY --chown=1000:1000 deploy/start.sh deploy/start.sh
# /data is where compose mounts the persistent database volume; a named volume is created owned by root, but this
# container runs as the unprivileged "node" user, so the directory needs to already be node's before that happens.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 7860
CMD ["bash", "deploy/start.sh", "web"]

# ---- target "ai": Python only ----
FROM python:3.13-slim AS ai
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/opt/hf
RUN useradd --create-home --uid 1000 app
WORKDIR /app
COPY requirements-runtime.txt .
# CPU-only PyTorch: the default wheel drags in gigabytes of CUDA libraries the image never uses.
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu torch \
 && pip install -r requirements-runtime.txt
# Bake the embedding model into the image so the first question does not download it.
RUN python -c "from sentence_transformers import SentenceTransformer as S; S('sentence-transformers/all-MiniLM-L6-v2')" \
 && chown -R app:app /opt/hf
ENV HF_HUB_OFFLINE=1
COPY --chown=app:app agents agents
COPY --chown=app:app ai_service ai_service
COPY --chown=app:app rag rag
COPY --chown=app:app contracts contracts
COPY --chown=app:app tests_qa/__init__.py tests_qa/urls.py tests_qa/
COPY --chown=app:app deploy/start.sh deploy/start.sh
RUN mkdir -p tests_qa/evidence && chown app:app tests_qa/evidence
USER app
EXPOSE 8100
CMD ["bash", "deploy/start.sh", "ai"]

# ---- default target "app": both in one container (Hugging Face Space, port 7860) ----
FROM ai AS app
USER root
COPY --from=node:24-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=web /app/services/billing services/billing
COPY --from=web /app/web web
RUN chown -R app:app /app/services /app/web
USER app
ENV NODE_ENV=production PORT=7860 HOST=0.0.0.0
EXPOSE 7860
CMD ["bash", "deploy/start.sh", "all"]
