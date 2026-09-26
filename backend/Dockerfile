FROM node:22-alpine AS build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist ./dist
COPY database/schema.sql /app/database/schema.sql
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
