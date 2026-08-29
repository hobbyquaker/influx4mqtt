FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY index.js config.js ./
COPY lib/ ./lib/

ENV NODE_ENV=production \
    INFLUX4MQTT_MQTT_URL=mqtt://localhost \
    INFLUX4MQTT_INFLUX_URL=http://localhost:8086 \
    INFLUX4MQTT_NAME=influx \
    INFLUX4MQTT_VERBOSITY=info

# nothing is stored locally: points are buffered in memory and written to influxdb
USER node

ENTRYPOINT ["node", "index.js"]
