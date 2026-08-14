FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY services/reviewer/package.json services/reviewer/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY packages/core packages/core
COPY services/reviewer services/reviewer
RUN npm run build -w @vitnera/core && npm run build -w @vitnera/reviewer

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/core packages/core
COPY --from=build /app/services/reviewer services/reviewer
USER node
CMD ["npm", "run", "start", "-w", "@vitnera/reviewer"]
