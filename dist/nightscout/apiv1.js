"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Client = void 0;
const axios_1 = __importDefault(require("axios"));
class Client {
    baseUrl;
    headers;
    device;
    constructor(config) {
        this.baseUrl = config.nightscoutBaseUrl;
        this.headers = {
            "api-secret": config.nightscoutApiToken,
            "User-Agent": "FreeStyle LibreLink Up NightScout Uploader",
            "Content-Type": "application/json",
        };
        this.device = config.nightscoutDevice;
    }
    async lastEntry() {
        const url = new URL("/api/v1/entries?count=1", this.baseUrl).toString();
        const resp = await axios_1.default.get(url, { headers: this.headers });
        if (resp.status !== 200) {
            throw Error(`failed to get last entry: ${resp.statusText}`);
        }
        if (!resp.data || resp.data.length === 0) {
            return null;
        }
        return resp.data.pop();
    }
    async uploadEntries(entries) {
        const url = new URL("/api/v1/entries", this.baseUrl).toString();
        const entriesV1 = entries.map((e) => ({
            type: "sgv",
            sgv: e.sgv,
            direction: e.direction?.toString(),
            device: this.device,
            date: e.date.getTime(),
            dateString: e.date.toISOString(),
        }));
        const resp = await axios_1.default.post(url, entriesV1, { headers: this.headers });
        if (resp.status !== 200) {
            throw Error(`failed to post new entries: ${resp.statusText} ${resp.status}`);
        }
        return;
    }
}
exports.Client = Client;
