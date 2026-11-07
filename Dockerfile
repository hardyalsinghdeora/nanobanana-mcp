FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js stdio.js tools.js safe-fetch.js ./
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.js"]
