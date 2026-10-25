FROM node:20-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json* turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-utils/package.json packages/shared-utils/
COPY packages/shared-validation/package.json packages/shared-validation/
RUN npm install

FROM node:20-alpine AS build
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
# Build shared workspace packages first so apps/api can resolve them
RUN cd packages/shared-types && npx tsc -p tsconfig.json \
 && cd ../shared-utils && npx tsc -p tsconfig.json \
 && cd ../shared-validation && npx tsc -p tsconfig.json
RUN cd apps/api && npx prisma generate && npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Need openssl for Prisma at runtime on Alpine
RUN apk add --no-cache openssl
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/packages ./packages
COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/apps/api/prisma ./prisma
COPY --from=build /workspace/apps/api/package.json ./package.json
# The commit this image was built from (deploy.sh: --build-arg GIT_COMMIT_SHA=<sha>). GET /api/v1/health
# reports it as `version`, so a deploy can check that the build it made is the one answering. Last, so a
# new commit rebuilds no other layer. Without the argument (Railway), it stays empty.
ARG GIT_COMMIT_SHA=
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
EXPOSE 3000
CMD ["node", "dist/main.js"]
