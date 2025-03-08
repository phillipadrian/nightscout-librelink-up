"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
exports.getGlucoseMeasurements = getGlucoseMeasurements;
exports.getLibreLinkUpConnection = getLibreLinkUpConnection;
exports.createFormattedMeasurements = createFormattedMeasurements;
/**
 * Nightscout LibreLink Up Uploader/Sidecar
 * Script written in TypeScript that uploads CGM readings from LibreLink Up to Nightscout.
 *
 * SPDX-License-Identifier: MIT
 */
const llu_api_endpoints_1 = require("./constants/llu-api-endpoints");
const cron = __importStar(require("node-cron"));
const axios_1 = __importDefault(require("axios"));
const winston_1 = require("winston");
const helpers_1 = require("./helpers/helpers");
const apiv1_1 = require("./nightscout/apiv1");
const apiv3_1 = require("./nightscout/apiv3");
const config_1 = __importDefault(require("./config"));
const tough_cookie_1 = require("tough-cookie");
const http_1 = require("http-cookie-agent/http");
const node_https_1 = require("node:https");
const crypto = __importStar(require("crypto"));
// Generate new Ciphers for stealth mode in order to bypass SSL fingerprinting used by Cloudflare.
// The new Ciphers are then used in the HTTPS Agent for Axios.
const defaultCiphers = crypto.constants.defaultCipherList.split(":");
const stealthCiphers = [
    defaultCiphers[0],
    defaultCiphers[2],
    defaultCiphers[1],
    ...defaultCiphers.slice(3)
];
const stealthHttpsAgent = new node_https_1.Agent({
    ciphers: stealthCiphers.join(":")
});
// Create a new CookieJar and HttpCookieAgent for Axios to handle cookies.
const jar = new tough_cookie_1.CookieJar();
const cookieAgent = new http_1.HttpCookieAgent({ cookies: { jar } });
let config = (0, config_1.default)();
const { combine, timestamp, printf } = winston_1.format;
const logFormat = printf(({ level, message }) => {
    return `[${level}]: ${message}`;
});
const logger = (0, winston_1.createLogger)({
    format: combine(timestamp(), logFormat),
    transports: [
        new winston_1.transports.Console({ level: config.logLevel }),
    ]
});
axios_1.default.interceptors.response.use(response => response, error => {
    if (error.response) {
        logger.error(JSON.stringify(error.response.data));
    }
    else {
        logger.error(error.message);
    }
    return error;
});
const USER_AGENT = "Mozilla/5.0 (iPhone; CPU OS 17_4.1 like Mac OS X) AppleWebKit/536.26 (KHTML, like Gecko) Version/17.4.1 Mobile/10A5355d Safari/8536.25";
/**
 * LibreLink Up API Settings (Don't change this unless you know what you are doing)
 */
const LIBRE_LINK_UP_VERSION = "4.12.0";
const LIBRE_LINK_UP_PRODUCT = "llu.ios";
const LIBRE_LINK_UP_URL = llu_api_endpoints_1.LLU_API_ENDPOINTS[config.linkUpRegion];
/**
 * last known authTicket
 */
let authTicket = { duration: 0, expires: 0, token: "" };
let userId = "";
const libreLinkUpHttpHeaders = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json;charset=UTF-8",
    "version": LIBRE_LINK_UP_VERSION,
    "product": LIBRE_LINK_UP_PRODUCT,
    "account-id": "",
};
if (config.singleShot) {
    main().then();
}
else {
    const schedule = `*/${config.linkUpTimeInterval} * * * *`;
    logger.info("Starting cron schedule: " + schedule);
    cron.schedule(schedule, () => {
        main().then();
    }, {});
}
async function main() {
    if (!hasValidAuthentication()) {
        logger.info("renew token");
        deleteAuthTicket();
        deleteAccountId();
        const authTicket = await login();
        if (!authTicket) {
            logger.error("LibreLink Up - No AuthTicket received. Please check your credentials.");
            deleteAuthTicket();
            deleteAccountId();
            return;
        }
        updateAuthTicket(authTicket);
    }
    const glucoseGraphData = await getGlucoseMeasurements();
    if (!glucoseGraphData) {
        return;
    }
    await uploadToNightScout(glucoseGraphData);
}
async function login() {
    config = (0, config_1.default)();
    try {
        const url = "https://" + LIBRE_LINK_UP_URL + "/llu/auth/login";
        const response = await axios_1.default.post(url, {
            email: config.linkUpUsername,
            password: config.linkUpPassword,
        }, {
            headers: libreLinkUpHttpHeaders,
            withCredentials: true, // Enable automatic cookie handling
            httpAgent: cookieAgent,
            httpsAgent: stealthHttpsAgent
        });
        try {
            if (response.data.status !== 0) {
                logger.error(`LibreLink Up - Non-zero status code: ${JSON.stringify(response.data)}`);
                return null;
            }
            if (response.data.data.redirect === true && response.data.data.region) {
                const correctRegion = response.data.data.region.toUpperCase();
                logger.error(`LibreLink Up - Logged in to the wrong region. Switch to '${correctRegion}' region.`);
                return null;
            }
            logger.info("Logged in to LibreLink Up");
            updateAccountId(response.data.data.user.id);
            return response.data.data.authTicket;
        }
        catch (err) {
            logger.error("Invalid authentication token. Please check your LibreLink Up credentials", err);
            return null;
        }
    }
    catch (error) {
        logger.error("Invalid credentials", error);
        return null;
    }
}
async function getGlucoseMeasurements() {
    config = (0, config_1.default)();
    try {
        const connectionId = await getLibreLinkUpConnection();
        if (!connectionId) {
            return null;
        }
        const url = "https://" + LIBRE_LINK_UP_URL + "/llu/connections/" + connectionId + "/graph";
        const response = await axios_1.default.get(url, {
            headers: getLluAuthHeaders(),
            withCredentials: true, // Enable automatic cookie handling
            httpAgent: cookieAgent,
            httpsAgent: stealthHttpsAgent,
        });
        return response.data.data;
    }
    catch (error) {
        logger.error("Error getting glucose measurements", error);
        deleteAuthTicket();
        deleteAccountId();
        return null;
    }
}
async function getLibreLinkUpConnection() {
    config = (0, config_1.default)();
    try {
        const url = "https://" + LIBRE_LINK_UP_URL + "/llu/connections";
        const response = await axios_1.default.get(url, {
            headers: getLluAuthHeaders(),
            withCredentials: true, // Enable automatic cookie handling
            httpAgent: cookieAgent,
            httpsAgent: stealthHttpsAgent,
        });
        const connectionData = response.data.data;
        if (connectionData.length === 0) {
            logger.error("No LibreLink Up connection found");
            return null;
        }
        if (connectionData.length === 1) {
            logger.info("Found 1 LibreLink Up connection.");
            logPickedUpConnection(connectionData[0]);
            return connectionData[0].patientId;
        }
        dumpConnectionData(connectionData);
        if (!config.linkUpConnection) {
            logger.warn("You did not specify a Patient-ID in the LINK_UP_CONNECTION environment variable.");
            logPickedUpConnection(connectionData[0]);
            return connectionData[0].patientId;
        }
        const connection = connectionData.filter(connectionEntry => connectionEntry.patientId === config.linkUpConnection)[0];
        if (!connection) {
            logger.error("The specified Patient-ID was not found.");
            return null;
        }
        logPickedUpConnection(connection);
        return connection.patientId;
    }
    catch (error) {
        logger.error("getting libreLinkUpConnection: ", error);
        deleteAuthTicket();
        deleteAccountId();
        return null;
    }
}
const nightscoutClient = config.nightscoutApiV3
    ? new apiv3_1.Client(config)
    : new apiv1_1.Client(config);
async function createFormattedMeasurements(measurementData) {
    const formattedMeasurements = [];
    const glucoseMeasurement = measurementData.connection.glucoseMeasurement;
    const measurementDate = (0, helpers_1.getUtcDateFromString)(glucoseMeasurement.FactoryTimestamp);
    const lastEntry = config.allData ? null : await nightscoutClient.lastEntry();
    // Add the most recent measurement first
    if (lastEntry === null || measurementDate > lastEntry.date) {
        formattedMeasurements.push({
            date: measurementDate,
            direction: (0, helpers_1.mapTrendArrow)(glucoseMeasurement.TrendArrow),
            sgv: glucoseMeasurement.ValueInMgPerDl
        });
    }
    measurementData.graphData.forEach((glucoseMeasurementHistoryEntry) => {
        const entryDate = (0, helpers_1.getUtcDateFromString)(glucoseMeasurementHistoryEntry.FactoryTimestamp);
        if (lastEntry === null || entryDate > lastEntry.date) {
            formattedMeasurements.push({
                date: entryDate,
                sgv: glucoseMeasurementHistoryEntry.ValueInMgPerDl,
            });
        }
    });
    return formattedMeasurements;
}
async function uploadToNightScout(measurementData) {
    const formattedMeasurements = await createFormattedMeasurements(measurementData);
    if (formattedMeasurements.length > 0) {
        logger.info("Trying to upload " + formattedMeasurements.length + " glucose measurement items to Nightscout");
        try {
            await nightscoutClient.uploadEntries(formattedMeasurements);
            logger.info("Upload of " + formattedMeasurements.length + " measurements to Nightscout succeeded");
        }
        catch (error) {
            logger.error("Upload to NightScout failed ", error);
        }
    }
    else {
        logger.info("No new measurements to upload");
    }
}
function dumpConnectionData(connectionData) {
    logger.debug("Found " + connectionData.length + " LibreLink Up connections:");
    connectionData.map((connectionEntry, index) => {
        logger.debug("[" + (index + 1) + "] " + connectionEntry.firstName + " " + connectionEntry.lastName + " (Patient-ID: " +
            connectionEntry.patientId + ")");
    });
}
function logPickedUpConnection(connection) {
    logger.info("-> The following connection will be used: " + connection.firstName + " " + connection.lastName + " (Patient-ID: " +
        connection.patientId + ")");
}
function getLluAuthHeaders() {
    const authenticatedHttpHeaders = libreLinkUpHttpHeaders;
    authenticatedHttpHeaders.Authorization = "Bearer " + getAuthenticationToken();
    if (authTicket) {
        try {
            // Add SHA-256 hashed account-id to the headers
            authenticatedHttpHeaders["account-id"] = crypto.createHash("sha256").update(getUserId()).digest("hex");
        }
        catch (error) {
            logger.error("Error getting accountId: ", error);
        }
    }
    logger.debug("authenticatedHttpHeaders: " + JSON.stringify(authenticatedHttpHeaders));
    return authenticatedHttpHeaders;
}
function deleteAuthTicket() {
    authTicket = { duration: 0, expires: 0, token: "" };
}
function updateAuthTicket(newAuthTicket) {
    authTicket = newAuthTicket;
}
function deleteAccountId() {
    userId = "";
}
function updateAccountId(newUserId) {
    userId = newUserId;
}
function getUserId() {
    return userId;
}
function getAuthenticationToken() {
    if (authTicket.token) {
        return authTicket.token;
    }
    logger.warn("no authTicket.token");
    return null;
}
function hasValidAuthentication() {
    if (authTicket.expires !== undefined) {
        const currentDate = Math.round(new Date().getTime() / 1000);
        return currentDate < authTicket.expires;
    }
    logger.info("no authTicket.expires");
    return false;
}
