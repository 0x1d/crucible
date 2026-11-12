# nshde runs on Bun (Bun.serve). Use Koyeb's Dockerfile builder, not Node buildpacks.
# bun.lock uses lockfileVersion 2 — requires Bun 1.4+ (oven/bun:1.2 is too old).
FROM oven/bun:1.4 AS base
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# NSH CLI packages App.tsx into a static web bundle served by Bun on the same PORT.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL https://nsh.dev/install.sh | sh \
  && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.local/bin:${PATH}"

COPY . .

RUN nsh package . --target web

ENV NODE_ENV=production
ENV NSHDE_WEB_DIR=.nsh/out/nshde
EXPOSE 8000

CMD ["bun", "src/server.ts"]
