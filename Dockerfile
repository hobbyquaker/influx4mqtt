FROM node:slim
LABEL maintainer="Holger Imbery <contact@connectedobjects.cloud>" \
      version="1.1a" \
      description="influx4mqtt dockerized version of https://github.com/hobbyquaker/influx4mqtt"

      RUN apt-get update \
       && apt-get install -y -q --no-install-recommends unzip \
          ca-certificates \
          bash \
          nginx \
          unzip \
          git \
       && apt-get clean \
       && rm -r /var/lib/apt/lists/* 
RUN npm config set unsafe-perm true && npm install -g influx4mqtt

ENTRYPOINT ["influx4mqtt"]
