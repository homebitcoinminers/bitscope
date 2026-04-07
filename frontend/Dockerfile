FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# Use a template — entrypoint substitutes $BITSCOPE_BACKEND_URL at runtime
COPY nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
# nginx:alpine's default entrypoint runs envsubst on /etc/nginx/templates/*.template
# and writes results to /etc/nginx/conf.d/ before starting nginx
