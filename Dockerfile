FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY config ./config
COPY src ./src
RUN mkdir -p /app/data
EXPOSE 8787
ENV PORT=8787
ENV HOST=0.0.0.0
CMD ["node", "src/server.js"]
