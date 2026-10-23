FROM debian:12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --chmod=0755 minio /usr/local/bin/minio
ENTRYPOINT ["/usr/local/bin/minio"]
