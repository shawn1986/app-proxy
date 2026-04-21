FROM node:22-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV APP_HOST=0.0.0.0
ENV APP_PORT=3000
ENV PROXY_HOST=0.0.0.0
ENV PROXY_PORT=18080
ENV DATA_DIR=/app/.data

EXPOSE 3000 18080

CMD ["npm", "run", "start"]
