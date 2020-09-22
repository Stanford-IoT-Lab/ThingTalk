// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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

import Type from '../type';

class TokenWrapper {
    constructor(token, value, location) {
        this.token = token;
        this.value = value;
        this.location = location;
    }

    toString() {
        return this.token;
    }
}

function isEntity(token) {
    // an entity is a token that starts with a fully uppercase word followed by _, followed by other stuff
    return /^[A-Z]+_/.test(token);
}

export default class SequenceLexer {
    constructor(sequence, entities) {
        this._sequence = sequence;
        if (!Array.isArray(sequence))
            this._sequence = Array.from(sequence);

        if (typeof entities !== 'function') {
            this._entities = (next) => {
                if (!(next in entities)) {
                    if (next.startsWith('SLOT_'))
                        return undefined;
                    throw new SyntaxError('Invalid entity ' + next + ', have ' + Object.keys(entities));
                }
                return entities[next];
            };
        } else {
            this._entities = entities;
        }

        this._i = 0;
        this._lastfunction = null;
        this._lastparam = null;
        this._instring = false;
    }

    next() {
        if (this._i >= this._sequence.length)
            return { done: true };

        let next = this._sequence[this._i++];
        if (next === '"') {
            this._instring = !this._instring;
        } else if (this._instring) {
            next = new TokenWrapper('WORD', next, this._i);
        } else if (/^[0-9]+$/.test(next) && next !== '0' && next !== '1') {
            next = new TokenWrapper('LITERAL_INTEGER', parseInt(next));
        } else if (/^time:[0-9]{1,2}:[0-9]{1,2}:[0-9]{1,2}$/.test(next)) {
            // need to remove 'time:' prefix because parser.lr uses split(':')[0] for hour
            next = new TokenWrapper('LITERAL_TIME', next.replace('time:', ''));
        } else if (isEntity(next)) {
            // check if we have a unit next, to pass to the entity retriever
            let unit = null;
            // note that this._i has already been increased
            if (this._i < this._sequence.length && this._sequence[this._i].startsWith('unit:'))
                unit = this._sequence[this._i].substring('unit:'.length);

            // entity
            const entity = this._entities(next, this._lastparam, this._lastfunction, unit);
            const entityType = next.substring(0, next.lastIndexOf('_'));
            if (entityType.startsWith('GENERIC_ENTITY_')) {
                next = new TokenWrapper('GENERIC_ENTITY', {
                    value: entity.value,
                    display: entity.display,
                    type: entityType.substring('GENERIC_ENTITY_'.length)
                });
            } else if (entityType.startsWith('MEASURE_')) {
                next = new TokenWrapper('MEASURE', entity);
            } else {
                next = new TokenWrapper(entityType, entity);
            }
        } else if (next.startsWith('@')) {
            this._lastfunction = next;
            let lastPeriod = next.lastIndexOf('.');
            let kind = next.substring(1, lastPeriod);
            let channel = next.substring(lastPeriod+1);
            if (!kind || !channel)
                throw new Error('Invalid function ' + next);
            if (channel === '*')
                next = new TokenWrapper('CLASS_STAR', kind);
            else
                next = new TokenWrapper('FUNCTION', { kind, channel });
        } else if (next.startsWith('enum:')) {
            next = new TokenWrapper('ENUM', next.substring('enum:'.length));
        } else if (next.startsWith('param:')) {
            let [,paramname,] = next.split(':');
            this._lastparam = paramname;
            next = new TokenWrapper('PARAM_NAME', paramname);
        } else if (next.startsWith('attribute:')) {
            let [,paramname,] = next.split(':');
            this._lastparam = paramname;
            next = new TokenWrapper('ATTRIBUTE_NAME', paramname);
        } else if (next.startsWith('unit:$')) {
            next = new TokenWrapper('CURRENCY_CODE', next.substring('unit:$'.length));
        } else if (next.startsWith('unit:')) {
            next = new TokenWrapper('UNIT', next.substring('unit:'.length));
        } else if (next.startsWith('device:')) {
            next = new TokenWrapper('DEVICE', next.substring('device:'.length));
        } else if (next.startsWith('special:')) {
            next = new TokenWrapper('SPECIAL', next.substring('special:'.length));
        } else if (next.startsWith('context:')) {
            const withoutPrefix = next.substring('context:'.length);
            const colon = withoutPrefix.indexOf(':');
            const name = withoutPrefix.substring(0, colon);
            const type = Type.fromString(withoutPrefix.substring(colon+1));
            next = new TokenWrapper('CONTEXT_REF', { name, type });
        } else if (next.startsWith('^^')) {
            next = new TokenWrapper('ENTITY_TYPE', next.substring('^^'.length));
        }
        return { done: false, value: next };
    }
}
