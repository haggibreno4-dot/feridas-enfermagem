FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN node --check server.js && node --check script.js && node --check advanced.js && node --check learning.js && node --check atlas.js && node --check clinical-utils.js && node --check clinical-records.js && node --check clinical-pdf.js && npm test
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
