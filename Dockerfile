FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && mkdir -p /app/var && chown node:node /app/var
COPY --from=build /app/dist ./dist
COPY --from=build /app/corpus ./corpus
COPY --from=build /app/db ./db
COPY --from=build /app/tools/admin.ts ./tools/admin.ts
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/src/shared ./src/shared
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
