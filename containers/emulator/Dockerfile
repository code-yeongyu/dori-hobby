FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		desmume \
		xvfb \
		x11-utils \
		xdotool \
		imagemagick \
		ffmpeg \
		curl \
		ca-certificates \
		unzip \
		procps \
		tini \
	&& rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

COPY containers/emulator/cheats/ /app/cheats/
COPY containers/emulator/config/ /app/config/
COPY containers/emulator/entrypoint.sh /app/entrypoint.sh
COPY containers/emulator/input-bridge/ /app/input-bridge/

# T4 note: input-bridge is implemented in T5, so package.json may be absent
# during isolated Dockerfile validation. Skip install in that case.
RUN cd /app/input-bridge \
	&& if [ -f bun.lockb ] || [ -f bun.lock ]; then \
		bun install --frozen-lockfile; \
	elif [ -f package.json ]; then \
		bun install; \
	else \
		echo "[docker] input-bridge package not present yet; skipping bun install"; \
	fi

RUN chmod +x /app/entrypoint.sh

ENV DISPLAY=:99
ENV XAUTHORITY=/tmp/.Xauthority

EXPOSE 7878

ENTRYPOINT ["tini", "--", "/app/entrypoint.sh"]
