// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2016-2020 The Board of Trustees of the Leland Stanford Junior University
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

import * as adt from 'adt';
import * as TTUnits from 'thingtalk-units';

import * as Grammar from './grammar';

function normalizeUnit(unit) {
    if (unit.startsWith('default')) {
        switch (unit) {
        case 'defaultTemperature':
            return 'C';
        default:
            throw new Error('Invalid default unit');
        }
    } else {
        return TTUnits.normalizeUnit(unit);
    }
}

// strictly speaking, Measure and Arrays are not types, they are type constructors
// (kind * -> *)
// isAssignable() has the magic to check types

/**
 * The base class of all ThingTalk types.
 *
 * @class
 * @abstract
 */
const Type = adt.data(function() {
    /* eslint no-invalid-this: off */

    return /** @lends Type */ {
        Any: null, // polymorphic hole
        Boolean: null,
        String: null,
        Number: null,
        Currency: null,
        Entity: { // a typed string (username, hashtag, url, picture...)
            type: adt.only(String), // the entity type, as RDF-style prefix:name
        },
        Measure: {
            // '' means any unit, creating a polymorphic type
            // any other value is a base unit (m for length, C for temperature)
            unit: normalizeUnit,
        },
        Enum: {
            entries: adt.only(Array, null) // of string
        },
        Array: {
            elem: adt.only(this, String),
        },
        Time: null,
        Date: null,
        RecurrentTimeSpecification: null,
        Location: null,
        Tuple: {
            schema: adt.only(Array),
        },
        Type: null,
        ArgMap: null,
        Object: null,
        Compound: {
            name: adt.only(String, null),
            fields: adt.only(Object)
        },

        // forward compatibility: a type that we know nothing about,
        // because it was introduced in a later version of the language
        Unknown: {
            name: adt.only(String)
        }
    };
});

Type.prototype.isNumeric = function() {
    return this.isNumber || this.isMeasure || this.isCurrency;
};
Type.prototype.isComparable = function() {
    return this.isNumeric() || this.isDate || this.isTime || this.isString;
};

Object.getPrototypeOf(Type.Tuple([])).toString = function toString() {
    return `(${this.schema})`;
};
Object.getPrototypeOf(Type.Unknown('')).toString = function toString() {
    return this.name;
};
Object.getPrototypeOf(Type.Compound('', {})).toString = function toString() {
    if (this.name)
        return `Compound(${this.name})`;
    return `Compound`;
};

export default Type;

Type.fromString = function(str) {
    if (str instanceof Type)
        return str;

    return Grammar.parse(str, { startRule: 'type_ref' });
};

function arrayEquals(a, b) {
    if (a === null && b === null)
        return true;
    if (a === null || b === null)
        return false;
    if (a.length !== b.length)
        return false;

    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }

    return true;
}

function entitySubType(type, assignableTo) {
    if (type === 'tt:username' || type === 'tt:contact_name') {
        return assignableTo === 'tt:phone_number' ||
            assignableTo === 'tt:email_address' ||
            assignableTo === 'tt:contact';
    }
    if (type === 'tt:contact_group_name')
        return assignableTo === 'tt:contact_group';
    if (type === 'tt:picture_url')
        return assignableTo === 'tt:url';
    return false;
}

Type.isAssignable = function isAssignable(type, assignableTo, typeScope = {}, lenient = false) {
    if (typeof assignableTo === 'string') {
        if (typeScope[assignableTo])
            return isAssignable(type, typeScope[assignableTo], typeScope, lenient);
        typeScope[assignableTo] = type;
        return true;
    }
    if (type.equals(assignableTo))
        return true;

    // if the types are different, and one of them is unknown, we err to
    // fail to assign (which causes a type error) because we don't know
    // the assignment rules
    if (type.isUnknown || assignableTo.isUnknown)
        return false;

    if (type.isAny || assignableTo.isAny)
        return true;
    if (type.isMeasure && assignableTo.isMeasure && assignableTo.unit !== '') {
        if (type.unit === assignableTo.unit)
            return true;
    }
    if (type.isMeasure && assignableTo.isMeasure && assignableTo.unit === '') {
        if (!typeScope['_unit']) {
            typeScope['_unit'] = type.unit;
            return true;
        }
        if (typeScope['_unit'] && typeScope['_unit'] === type.unit)
            return true;
        return false;
    }
    if (type.isTuple && assignableTo.isTuple) {
        return type.schema.length === assignableTo.schema.length &&
            type.schema.every((t, i) => isAssignable(t, assignableTo.schema[i]));
    }
    if (type.isArray && assignableTo.isArray &&
        typeof assignableTo.elem === 'string') {
        if (typeScope[assignableTo.elem])
            return isAssignable(type.elem, typeScope[assignableTo.elem], typeScope, lenient);
        typeScope[assignableTo.elem] = type.elem;
        return true;
    }
    if (type.isArray && assignableTo.isArray && type.elem.isAny)
        return true;
    if (type.isArray && assignableTo.isArray && isAssignable(type.elem, assignableTo.elem, typeScope, lenient))
        return true;
    if (type.isArray && assignableTo.isEntity && assignableTo.type === 'tt:contact_group')
        return isAssignable(type.elem, Type.Entity('tt:contact'), typeScope, lenient);
    if (type.isDate && assignableTo.isTime)
        return true;
    if (type.isNumber && assignableTo.isCurrency) 
        return true;
    if (lenient && type.isEntity && assignableTo.isString)
        return true;
    if (lenient && type.isString && assignableTo.isEntity) {
        //console.log('Using String for ' + assignableTo + ' is deprecated');
        return true;
    }
    if (type.isEnum && assignableTo.isEnum && type.entries === null)
        return true;
    if (type.isEnum && assignableTo.isEnum && arrayEquals(type.entries, assignableTo.entries))
        return true;
    if (type.isEnum && assignableTo.isEnum && type.entries[type.entries.length-1] === '*' &&
        type.entries.slice(0, type.entries.length-1).every((entry) => assignableTo.entries.includes(entry)))
        return true;
    if (type.isEntity && assignableTo.isEntity && assignableTo.type === '') {
        if (!typeScope['_entity']) {
            typeScope['_entity'] = type.type;
            return true;
        }
        if (typeScope['_entity'] && typeScope['_entity'] === type.type)
            return true;
        return false;
    }
    if (type.isEntity && assignableTo.isEntity && entitySubType(type.type, assignableTo.type))
        return true;
    if (type.isArgMap && assignableTo.isArgMap)
        return true;
    return false;
};
