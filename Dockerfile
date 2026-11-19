FROM node:20-alpine

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev

COPY public ./public
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
ENV HTTPS_PORT=3443
ENV REDIRECT_HTTP_TO_HTTPS=false

# Provide TLS files at runtime (mount secrets/volumes) and set:
# SSL_KEY_PATH=/run/secrets/tls.key
# SSL_CERT_PATH=/run/secrets/tls.crt

EXPOSE 3000 3443

USER node

CMD ["npm", "start"]