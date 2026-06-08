FROM node:22-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /server

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . . 

RUN chown -R appuser:appgroup /server

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

CMD [ "node","server.js" ]