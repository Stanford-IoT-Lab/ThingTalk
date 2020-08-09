// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2018-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const assert = require('assert');

const TIME_UNITS = ['ms', 's', 'min', 'h', 'day', 'week', 'mon', 'year'];
const SET_ZERO = [(d) => {},
    (d) => {
        d.setMilliseconds(0); // start of current second
    },
    (d) => {
        d.setSeconds(0, 0); // start of current minute
    },
    (d) => {
        d.setMinutes(0, 0, 0); // start of current hour
    },
    (d) => {
        d.setHours(0, 0, 0, 0); // start of current day
    },
    (d) => {
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate()-d.getDay()); // start of current week (week starts Sunday)
    },
    (d) => {
        d.setHours(0, 0, 0, 0);
        d.setDate(1); // start of current month
    },
    (d) => {
        d.setHours(0, 0, 0, 0);
        d.setMonth(0, 1); // start of current year
    }
];
const ADD_ONE = [
    (d) => {
        d.setMilliseconds(d.getMilliseconds()+1);
    },
    (d) => {
        d.setSeconds(d.getSeconds()+1);
    },
    (d) => {
        d.setMinutes(d.getMinutes()+1);
    },
    (d) => {
        d.setHours(d.getHours()+1);
    },
    (d) => {
        d.setDate(d.getDate()+1);
    },
    (d) => {
        d.setDate(d.getDate()+7);
    },
    (d) => {
        d.setMonth(d.getMonth()+1);
    },
    (d) => {
        d.setFullYear(d.getFullYear()+1);
    }
];
assert(SET_ZERO.length === TIME_UNITS.length);
assert(ADD_ONE.length === TIME_UNITS.length);


function createEdgeDate(edge, unit) {
    const index = TIME_UNITS.indexOf(unit);

    const date = new Date;
    SET_ZERO[index](date);
    if (edge === 'end_of')
        ADD_ONE[index](date);
    return date;
}

function createDatePiece(year, month, day, time) {
    // All non-supplied values to the left of the largest supplied
    // value are set to the present. All non-supplied values to the
    // right of the largest supplied value are set to the minimum.
    const date = new Date;
    if (year > 0) {
        date.setYear(year);
        date.setMonth(0, 1); // 1st of Jan
        date.setHours(0, 0, 0, 0);
    }
    if (month > 0) {
        date.setMonth(month - 1, 1);
        date.setHours(0, 0, 0, 0);
    }
    if (day > 0) {
        date.setDate(day);
        date.setHours(0, 0, 0, 0);
    }
    if (time !== null)
        date.setHours(time.hour, time.minute, time.second);
    return date;
}

module.exports = {
    normalizeDate(value) {
        if (value === null)
            return new Date;
        else if (value instanceof Date)
            return value;
        else if (typeof value.edge === 'undefined')
            return createDatePiece(value.year, value.month, value.day, value.time);
        else
            return createEdgeDate(value.edge, value.unit);
    },

    parseDate(form) {
        if (form instanceof Date)
            return form;

        let now = new Date;
        now.setMilliseconds(0);

        let year = form.year;
        if (year < 0 || year === undefined)
            year = now.getFullYear();
        let month = form.month;
        if (month < 0 || month === undefined)
            month = now.getMonth() + 1;
        let day = form.day;
        if (day < 0 || day === undefined)
            day = now.getDate();
        let hour = form.hour;
        if (hour < 0 || hour === undefined)
            hour = 0;
        let minute = form.minute;
        if (minute < 0 || minute === undefined)
            minute = 0;
        let second = form.second;
        if (second < 0 || second === undefined)
            second = 0;
        let millisecond = (second - Math.floor(second))*1000;
        second = Math.floor(second);

        return new Date(year, month-1, day, hour, minute, second, millisecond);
    },
};
