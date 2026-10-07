# Multi-stage Dockerfile for CodeJudge Backend (API & Worker)
FROM node:20-alpine AS base

WORKDIR /app

# Install curl for healthcheck probe
RUN apk add --no-cache curl

# Install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Production Image
FROM node:20-alpine AS production

WORKDIR /app

# Install curl for container health checks
RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV PORT=5000

# Security: Non-root user
USER node

# Copy production node_modules from base stage
COPY --chown=node:node --from=base /app/node_modules ./node_modules
COPY --chown=node:node . .

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

CMD ["node", "src/server.js"]
