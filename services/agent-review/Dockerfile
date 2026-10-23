FROM node:22.19.0-bookworm-slim
WORKDIR /app

RUN npm install --omit=dev --no-audit --no-fund --save-exact @earendil-works/pi-coding-agent@1.1.0
COPY bundle/bundle.js ./
COPY bundle/check.js ./

CMD ["node", "bundle.js"]
