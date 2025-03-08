"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapTrendArrow = mapTrendArrow;
exports.getUtcDateFromString = getUtcDateFromString;
/**
 * Helper Functions
 *
 * SPDX-License-Identifier: MIT
 */
const interface_1 = require("../nightscout/interface");
function mapTrendArrow(libreTrendArrowRaw) {
    switch (libreTrendArrowRaw) {
        case 1:
            return interface_1.Direction.SingleDown;
        case 2:
            return interface_1.Direction.FortyFiveDown;
        case 3:
            return interface_1.Direction.Flat;
        case 4:
            return interface_1.Direction.FortyFiveUp;
        case 5:
            return interface_1.Direction.SingleUp;
        default:
            return interface_1.Direction.NotComputable;
    }
}
function getUtcDateFromString(timeStamp) {
    const utcDate = new Date(timeStamp);
    utcDate.setTime(utcDate.getTime() - utcDate.getTimezoneOffset() * 60 * 1000);
    return utcDate;
}
