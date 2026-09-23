# ==============================================================================
# Stage 1: Build Stage
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and config
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript to JavaScript (dist/)
RUN npm run build

# Remove development dependencies to keep production footprint tiny
RUN npm prune --production

# ==============================================================================
# Stage 2: Production Runner (Production Grade & Zeabur Compatible)
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5200

# Security: Run as non-root user
USER node

# Copy only production dependencies and compiled artifacts
COPY --chown=node:node package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist

# Application Web Dashboard port in 52XX series
EXPOSE 5200

# Default command: Runs the compiled application (poller + MCP server)
CMD ["node", "dist/index.js"]
