// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const vm = require('vm');

const { clean } = require('../utils');
const FormatUtils = require('../format_utils');

function compileCode(code) {
    return vm.runInNewContext(code);
}

module.exports = class Formatter extends FormatUtils {
    constructor(locale, timezone, schemaRetriever, gettext) {
        super(locale, timezone);
        this._schemas = schemaRetriever;
        if (gettext)
            this._ = gettext.dgettext.bind(gettext, 'thingtalk');
        else
            this._ = (x) => x;
    }

    _displayValue(value, opt) {
        if (value === undefined || value === null)
            return value;
        if (Array.isArray(value))
            return value.map((v) => this._displayValue(v, opt)).join(', ');
        if (value.display)
            return value.display;
        if (value instanceof Date) {
            if (opt === 'iso-date')
                return value.toISOString();
            if (opt === 'time')
                return this.timeToString(value);
            else if (opt === 'date')
                return this.dateToString(value);
            else
                return this.dateAndTimeToString(value);
        }
        if (opt === 'enum')
            return clean(String(value));
        if (typeof value === 'number') {
            if (opt === '%') {
                value = value*100;
                opt = '';
            }
            if (opt)
                return this.measureToString(value, 1, opt);
            else
                return (Math.floor(value) === value ? value.toFixed(0) : value.toFixed(2));
        }
        if (value.x && value.y)
            return this.locationToString(value);
        else
            return value.toLocaleString(this._locale);
    }

    _replaceInString(str, argMap) {
        if (typeof str !== 'string')
            return undefined;
        return str.replace(/\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::(%|[a-zA-Z-]+))?})/g, (match, param1, param2, opt) => {
            if (match === '$$')
                return '$';
            let param = param1 || param2;
            if (param.startsWith('{'))
                param = param.substring(0, param.length-1);
            let value = argMap[param];
            return this._displayValue(value, opt);
        });
    }

    _formatFallback(outputValue) {
        return Object.keys(outputValue).map((key) => {
            return `${clean(key)}: ${this._displayValue(outputValue[key])}`;
        });
    }

    _formatAggregation(outputValue, operator, outputType) {
        if (operator === 'count' && outputValue.hasOwnProperty('count'))
            return [this._("I found %d results.").format(outputValue.count)];

        let key = Object.keys(outputValue)[0];

        switch (operator) {
        case 'count':
            return [this._("I found %d distinct values of %s.").format(outputValue[key], clean(key))];

        case 'min':
            return [this._("The minimum %s is %s.").format(clean(key), this._displayValue(outputValue[key]))];

        case 'max':
            return [this._("The maximum %s is %s.").format(clean(key), this._displayValue(outputValue[key]))];

        case 'avg':
            return [this._("The average %s is %s.").format(clean(key), this._displayValue(outputValue[key]))];

        case 'sum':
            return [this._("The total %s is %s.").format(clean(key), this._displayValue(outputValue[key]))];

        default:
            throw new TypeError(`Unexpected aggregation operator ${operator}`);
        }
    }

    async formatForType(outputType, outputValue, hint) {
        // apply masquerading for @remote.receive
        // outputValue[0..2] are the input parameters (principal, programId and flow)
        // outputValue[3] is the real underlying output type, and outputValue.slice(4)
        // is the real data
        if (outputType === 'org.thingpedia.builtin.thingengine.remote:receive')
            outputType = String(outputValue.__kindChannel);

        // Handle builtin:get_commands specially
        if (outputType === 'org.thingpedia.builtin.thingengine.builtin:get_commands')
            return { type: 'program', program: outputValue.program };


        if (outputType === null)
            return this._formatFallback(outputValue);

        // for now, ignore multiple output types
        if (outputType.indexOf('+') >= 0) {
            let types = outputType.split('+');
            outputType = types[types.length-1];
        }

        const aggregation = /^([a-zA-Z]+)\(([^)]+)\)$/.exec(outputType);
        if (aggregation !== null)
            return this._formatAggregation(outputValue, aggregation[1], aggregation[2]);

        let [kind, function_name] = outputType.split(':');
        return this._schemas.getFormatMetadata(kind, function_name).then((metadata) => {
            if (metadata.length)
                return this.format(metadata, outputValue, hint);
            else
                return this._formatFallback(outputValue);
        });
    }

    format(formatspec, argMap, hint) {
        return this._postprocess(formatspec.map((f, i) => {
            if (typeof f === 'function')
                return f(argMap, hint, this);
            if (typeof f === 'string')
                return this._replaceInString(f, argMap) || '';
            if (typeof f !== 'object' || f === null)
                return String(f);
            if (f.type === 'text')
                return this._replaceInString(f.text, argMap) || '';
            if (f.type === 'picture') {
                return {
                    type: 'picture',
                    url: this._replaceInString(f.url, argMap)
                };
            }
            if (f.type === 'rdl') {
                return {
                    type: 'rdl',
                    callback: this._replaceInString(f.callback, argMap),
                    webCallback: this._replaceInString(f.webCallback, argMap),
                    displayTitle: this._replaceInString(f.displayTitle, argMap),
                    displayText: this._replaceInString(f.displayText, argMap)
                };
            }
            if (f.type === 'code') {
                var compiled = compileCode('(' + f.code + ')');
                formatspec[i] = compiled;
                return compiled(argMap, hint, this);
            }
            throw new Error('Unrecognized formatter type ' + f.type);
        }), hint);
    }

    _postprocess(formatted, hint) {
        if (typeof formatted === 'string')
            return formatted;
        if (formatted === null)
            return '';
        if (typeof formatted === 'object' &&
            formatted.type === 'text')
            return formatted.text;
        if (!Array.isArray(formatted))
            formatted = [formatted];

        if (hint === 'string') {
            formatted = formatted.map((x) => {
                if (typeof x === 'string')
                    return x;
                if (x === null)
                    return 'null';
                if (typeof x !== 'object')
                    return this.anyToString(x);
                if (x.type === 'text')
                    return x.text;
                if (x.type === 'picture')
                    return 'Picture: ' + x.url;
                if (x.type === 'rdl')
                    return 'Link: ' + x.displayTitle + ' <' + x.webCallback + '>';
                return this.anyToString(x);
            });
            return formatted.join('\n');
        } else {
            // flatten formatted (returning array in function causes nested array)
            return [].concat.apply([], formatted);
        }
    }

    anyToString(o) {
        if (Array.isArray(o))
            return (o.map(this.anyToString, this).join(', '));
        else if (typeof o === 'object' && o !== null &&
             o.hasOwnProperty('x') && o.hasOwnProperty('y'))
            return this.locationToString(o);
        else if (typeof o === 'number')
            return (Math.floor(o) === o ? o.toFixed(0) : o.toFixed(3));
        else if (o instanceof Date)
            return this.dateAndTimeToString(o);
        else
            return String(o);
    }
};
