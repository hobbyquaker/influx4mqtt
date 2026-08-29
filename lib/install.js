/**
 * --install / --uninstall: systemd template service influx4mqtt@<name> (mqtt-interfaces-core
 * installer). Nothing privileged — it talks to two network services and keeps no state.
 */

import {createInstaller} from 'mqtt-interfaces-core';

export const SERVICE = 'influx4mqtt';
export const ENV_PREFIX = 'INFLUX4MQTT';

const installer = createInstaller({
    service: SERVICE,
    envPrefix: ENV_PREFIX,
    description: `${SERVICE} %i - MQTT to InfluxDB recorder`,
    documentation: 'https://github.com/hobbyquaker/influx4mqtt',
});

export const {unitFile, envFile, installService, uninstallService, handle} = installer;
