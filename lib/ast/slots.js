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

import assert from 'assert';
import interpolate from 'string-interp';
import Type from '../type';
import * as I18n from '../i18n';
import { clean } from '../utils';

import { Value } from './values';

/**
 * The abstract representation of a slot.
 *
 * A slot is a placeholder for a value that can be replaced or changed by
 * API user. This API is used to iterate all values (parameters and filters)
 * in a program.
 *
 * @alias Ast~AbstractSlot
 */
class AbstractSlot {
    /**
     * Construct a new abstract slot.
     *
     * @param {module.Ast:Invocation|null} prim - the primitive associated with this slot, if any
     * @param {Object.<string, Ast.ScopeEntry>} scope - available names for parameter passing
     * @protected
     */
    constructor(prim, scope) {
        assert(prim || prim === null);
        this._prim = prim;


        this._scope = scope;
        this._options = undefined;
    }

    /**
     * The primitive associated with this slot, if any.
     * @type {Ast.Invocation|null}
     * @readonly
     */
    get primitive() {
        return this._prim;
    }
    /**
     * The function argument associated with this slot, if any.
     * @type {Ast.ArgumentDef|null}
     * @readonly
     */
    get arg() {
        return null;
    }
    /**
     * Names which are available for parameter passing into this slot.
     * @type {Object.<string, Ast.ScopeEntry>}
     * @readonly
     */
    get scope() {
        return this._scope;
    }

    /**
     * The available options to parameter pass from.
     *
     * This is the subset of {Ast~AbstractSlot#scope} whose type matches
     * that of this slot.
     * @type {Object.<string, Ast.ScopeEntry>}
     * @readonly
     */
    get options() {
        // this is computed lazily because it needs this.type, which
        // is not available in the constructor

        if (this._options)
            return this._options;

        let options = [];
        const slotType = this.type;
        for (let vname in this._scope) {
            let option = this._scope[vname];
            if (Type.isAssignable(option.type, slotType))
                options.push(option);
        }
        return this._options = options;
    }

    /* istanbul ignore next */
    /**
     * The type of this slot.
     * @type {Type}
     */
    get type() {
        throw new Error('Abstract method');
    }
    /* istanbul ignore next */
    /**
     * Retrieve the question to ask the user to fill this slot.
     *
     * @param {string} locale - the locale to use
    getPrompt(locale) {
        throw new Error('Abstract method');
    }
    /* istanbul ignore next */
    get() {
        throw new Error('Abstract method');
    }
    /* istanbul ignore next */
    set(value) {
        throw new Error('Abstract method');
    }

    isUndefined() {
        return this.get().isUndefined;
    }
    isConcrete() {
        return this.get().isConcrete();
    }
    isCompilable() {
        const value = this.get();
        if (value.isUndefined)
            return false;
        if (!value.isConcrete())
            return false;

        const valueType = value.getType();
        const slotType = this.type;
        if (valueType.isEntity && slotType.isEntity && valueType.type === 'tt:username' && slotType.type !== 'tt:username')
            return false;

        return true;
    }
}

export class InputParamSlot extends AbstractSlot {
    constructor(prim, scope, arg, slot) {
        super(prim, scope);
        this._arg = arg;
        this._slot = slot;
    }

    toString() {
        return `InputParamSlot(${this._slot.name} : ${this.type})`;
    }

    get _argcanonical() {
        return this._arg ? this._arg.canonical : clean(this._slot.name);
    }

    get arg() {
        return this._arg || null;
    }
    get type() {
        if (this._arg)
            return this._arg.type;
        else
            return Type.Any;
    }
    get tag() {
        return `in_param.${this._slot.name}`;
    }
    getPrompt(locale) {
        if (this._arg && this._arg.metadata.prompt)
            return this._arg.metadata.prompt;

        const argcanonical = this._argcanonical;
        const _ = I18n.get(locale).gettext;
        return interpolate(_("Please tell me the ${argcanonical}."), //"
            { argcanonical }, { locale });
    }
    get() {
        return this._slot.value;
    }
    set(value) {
        this._slot.value = value;
    }
}

export class ResultSlot extends AbstractSlot {
    constructor(prim, scope, arg, object, key) {
        super(prim, scope);
        this._arg = arg;
        this._object = object;
        this._key = key;
    }

    toString() {
        return `ResultSlot(${this._key} : ${this.type})`;
    }

    get _argcanonical() {
        return this._arg ? this._arg.canonical : clean(this._key);
    }

    get arg() {
        return this._arg || null;
    }
    get type() {
        if (this._arg)
            return this._arg.type;
        else
            return this.get().getType();
    }
    get tag() {
        return `result.${this._key}`;
    }
    getPrompt(locale) {
        // should never be called, except for tests

        if (this._arg && this._arg.metadata.prompt)
            return this._arg.metadata.prompt;

        const argcanonical = this._argcanonical;
        const _ = I18n.get(locale).gettext;
        return interpolate(_("Please tell me the ${argcanonical}."), //"
            { argcanonical }, { locale });
    }
    get() {
        return this._object[this._key];
    }
    set(value) {
        this._object[this._key] = value;
    }
}

export class DeviceAttributeSlot extends AbstractSlot {
    constructor(prim, attr) {
        super(prim, {});
        this._slot = attr;
        assert(this._slot.name === 'name');
    }

    toString() {
        return `DeviceAttributeSlot(${this._slot.name} : ${this.type})`;
    }

    get type() {
        return Type.String;
    }
    get tag() {
        return `attribute.${this._slot.name}`;
    }
    getPrompt(locale) {
        // this method should never be used, because $? does not typecheck in a device
        // attribute, but we include for completeness, and just in case
        const _ = I18n.get(locale).gettext;
        return _("Please tell me the name of the device you would like to use.");
    }
    get() {
        return this._slot.value;
    }
    set(value) {
        this._slot.value = value;
    }
}

export class FilterSlot extends AbstractSlot {
    constructor(prim, scope, arg, filter) {
        super(prim && prim.isPermissionRule ? null : prim, scope);

        this._isSourceFilter = prim && prim.isPermissionRule;
        this._arg = arg;
        this._filter = filter;
    }

    toString() {
        return `FilterSlot(${this._filter.name} ${this._filter.operator} : ${this.type})`;
    }

    get _argcanonical() {
        return this._arg ? this._arg.canonical : clean(this._filter.name);
    }

    // overidde the default option handling to filter out non-sensical filters such as "x == x"
    get options() {
        if (this._options)
            return this._options;
        let options = [];

        const slotType = this.type;
        for (let vname in this._scope) {
            let option = this._scope[vname];
            if (Type.isAssignable(option.type, slotType)) {
                if (option.value.isVarRef && option.value.name === this._filter.name &&
                    option._prim === this._prim)
                    continue;
                if (option.value.isEvent)
                    continue;
                options.push(option);
            }
        }
        return this._options = options;
    }

    get arg() {
        return this._arg || null;
    }
    get type() {
        if (this._isSourceFilter) {
            switch (this._filter.operator) {
            case 'in_array':
                return new Type.Array(Type.Entity('tt:contact'));
            default:
                return Type.Entity('tt:contact');
            }
        } else if (this._arg) {
            switch (this._filter.operator) {
            case 'contains':
                return this._arg.type.elem;
            case 'contains~':
                return Type.String;
            case '~contains':
                return Type.String;
            case 'in_array':
                return new Type.Array(this._arg.type);
            case 'in_array~':
                return new Type.Array(Type.String);
            case '~in_array':
                return Type.String;
            default:
                return this._arg.type;
            }
        } else {
            return Type.Any;
        }
    }
    get tag() {
        return `filter.${this._filter.operator}.${this._isSourceFilter ? '$' : ''}${this._filter.name}`;
    }
    getPrompt(locale) {
        const _ = I18n.get(locale).gettext;
        if (['==', 'contains', 'in_array', '=~'].indexOf(this._filter.operator) >= 0 &&
            this._arg && this._arg.metadata.prompt)
            return this._arg.metadata.prompt;

        if (this._isSourceFilter)
            return _("Who is allowed to ask you for this command?");

        const argcanonical = this._argcanonical;

        let question;
        switch (this._filter.operator) {
        case '>=':
            question = _("What should the ${argcanonical} be greater than?");
            break;
        case '<=':
            question = _("What should the ${argcanonical} be less than?");
            break;
        case 'starts_with':
            question = _("How should the ${argcanonical} start with?");
            break;
        case 'ends_with':
            question = _("How should the ${argcanonical} end with?");
            break;
        case '=~':
            question = _("What should the ${argcanonical} contain?");
            break;
        case '==':
            question = _("What should the ${argcanonical} be equal to?");
            break;
        default:
            // ugly default but guaranteed to work...
            question = _("Please tell me the value of the filter on the ${argcanonical}.");
            break;
        }

        return interpolate(question, { argcanonical }, { locale });
    }
    get() {
        return this._filter.value;
    }
    set(value) {
        this._filter.value = value;
    }
}

export class ArrayIndexSlot extends AbstractSlot {
    constructor(prim, scope, type, array, parent, index) {
        super(prim, scope);
        this._type = type;
        this._array = array;
        if (typeof parent === 'string') {
            this._baseTag = parent;
            this._parent = null;
        } else {
            this._baseTag = parent.tag;
            this._parent = parent;
        }
        this._index = index;
    }

    toString() {
        return `ArrayIndexSlot([${this._index}] : ${this.type})`;
    }

    get _argcanonical() {
        return this._parent._argcanonical;
    }

    get arg() {
        return this._parent ? this._parent.arg : null;
    }
    get type() {
        return this._type;
    }
    get tag() {
        return `${this._baseTag}.${this._index}`;
    }
    getPrompt(locale) {
        const _ = I18n.get(locale).gettext;

        switch (this._baseTag) {
        case 'table.index':

            if (this._array.length === 1)
                return _("Which result do you want?");

            return interpolate(_("${index:ordinal:\
                =1 {What is the index of the first result you would like?}\
                =2 {What is the index of the second result you would like?}\
                =3 {What is the index of the third result you would like?}\
                one {What is the index of the ${index}st result you would like?}\
                two {What is the index of the ${index}nd result you would like?}\
                few {What is the index of the ${index}rd result you would like?}\
                other {What is the index of the ${index}th result you would like?}\
            }"), { index: this._index+1 }, { locale });

        case 'attimer.time':
            if (this._array.length === 1)
                return _("When do you want your command to run?");

            return interpolate(_("${index:ordinal:\
                =1 {What is the first time you would like your command to run?}\
                =2 {What is the second time you would like your command to run?}\
                =3 {What is the third time you would like your command to run?}\
                one {What is the ${index}st time you would like your command to run?}\
                two {What is the ${index}nd time you would like your command to run?}\
                few {What is the ${index}rd time you would like your command to run?}\
                other {What is the ${index}th time you would like your command to run?}\
            }"), { index: this._index+1 }, { locale });

        case 'filter.in_array.$source':
            if (this._array.length === 1)
                return _("Who is allowed to ask you for this command?");

            return interpolate(_("${index:ordinal:\
                =1 {Who is the first friend who is allowed to ask you for this command?}\
                =2 {Who is the second friend who is allowed to ask you for this command?}\
                =3 {Who is the third friend who is allowed to ask you for this command?}\
                one {Who is the ${index}st friend who is allowed to ask you for this command?}\
                two {Who is the ${index}nd friend who is allowed to ask you for this command?}\
                few {Who is the ${index}rd friend who is allowed to ask you for this command?}\
                other {Who is the ${index}th friend who is allowed to ask you for this command?}\
            }"), { index: this._index+1 }, { locale });

        case 'compute_filter.lhs':
            if (this._array.length === 1)
                return _("What is the left hand side of the filter?");

            return interpolate(_("${index:ordinal:\
                =1 {What is the first value of the filter left hand side?}\
                =2 {What is the second value of the filter left hand side?}\
                =3 {What is the third value of the filter left hand side?}\
                one {What is the ${index}st value of the filter left hand side?}\
                two {What is the ${index}nd value of the filter left hand side?}\
                few {What is the ${index}rd value of the filter left hand side?}\
                other {What is the ${index}th value of the filter left hand side?}\
            }"), { index: this._index+1 }, { locale });

        case 'compute_filter.rhs':
            if (this._array.length === 1)
                return _("What is the right hand side of the filter?");

            return interpolate(_("${index:ordinal:\
                =1 {What is the first value of the filter right hand side?}\
                =2 {What is the second value of the filter right hand side?}\
                =3 {What is the third value of the filter right hand side?}\
                one {What is the ${index}st value of the filter right hand side?}\
                two {What is the ${index}nd value of the filter right hand side?}\
                few {What is the ${index}rd value of the filter right hand side?}\
                other {What is the ${index}th value of the filter right hand side?}\
            }"), { index: this._index+1 }, { locale });

        default:
            assert(this._parent);
            // array is input parameter or filter
            if (this._array.length === 1)
                return this._parent.getPrompt(locale);

            return interpolate(_("${index:ordinal:\
                =1 {What would you like the first ${argcanonical} to be?}\
                =2 {What would you like the second ${argcanonical} to be?}\
                =3 {What would you like the third ${argcanonical} to be?}\
                one {What would you like the ${index}st ${argcanonical} to be?}\
                two {What would you like the ${index}nd ${argcanonical} to be?}\
                few {What would you like the ${index}rd ${argcanonical} to be?}\
                other {What would you like the ${index}th ${argcanonical} to be?}\
            }"), { index: this._index+1, argcanonical: this._argcanonical }, { locale });
        }
    }
    get() {
        return this._array[this._index];
    }
    set(value) {
        this._array[this._index] = value;
    }
}

export class ComputationOperandSlot extends AbstractSlot {
    constructor(prim, scope, type, operator, operands, parent, index) {
        super(prim, scope);
        this._type = type;
        this._operator = operator;
        this._operands = operands;
        if (typeof parent === 'string') {
            this._baseTag = parent;
            this._parent = null;
        } else {
            this._baseTag = parent.tag;
            this._parent = parent;
        }
        this._index = index;
    }

    toString() {
        return `ComputationOperandSlot(${this._operator}[${this._index}] : ${this.type})`;
    }

    get _argcanonical() {
        return this._parent._argcanonical;
    }

    get arg() {
        return this._parent ? this._parent.arg : null;
    }
    get type() {
        return this._type;
    }
    get tag() {
        return `${this._baseTag}.${this._operator}.${this._index}`;
    }
    getPrompt(locale) {
        const _ = I18n.get(locale).gettext;

        // ugly but who cares
        return interpolate(_("${index:ordinal:\
            =1 {What is the first operand to ${operator} you would like?}\
            =2 {What is the second operand to ${operator} you would like?}\
            =3 {What is the third operand to ${operator} you would like?}\
            one {What is the ${index}st operand to ${operator} you would like?}\
            two {What is the ${index}nd operand to ${operator} you would like?}\
            few {What is the ${index}rd operand to ${operator} you would like?}\
            other {What is the ${index}th operand to ${operator} you would like?}\
        }"), { index: this._index+1, operator: this._operator }, { locale });
    }
    get() {
        return this._operands[this._index];
    }
    set(value) {
        this._operands[this._index] = value;
    }
}

export class FieldSlot extends AbstractSlot {
    constructor(prim, scope, type, container, baseTag, field) {
        super(prim, scope);
        this._type = type;
        this._container = container;
        this._tag = baseTag + '.' + field;
        this._field = field;
    }

    toString() {
        return `FieldSlot(${this._field} : ${this.type})`;
    }

    get type() {
        return this._type;
    }
    get tag() {
        return this._tag;
    }

    getPrompt(locale) {
        const _ = I18n.get(locale).gettext;

        switch (this._tag) {
        case 'program.principal':
            return _("Who should run this command?");
        case 'timer.base':
            return _("When would you like your command to start?");
        case 'timer.interval':
            return _("How often should your command run?");
        case 'timer.frequency':
            return _("How many times should your command run during that time interval?");
        case 'attimer.expiration_date':
            return _("When should your command stop?");
        case 'slice.base':
            return _("What is the first result you would like?");
        case 'slice.limit':
            return _("How many results would you like?");
        case 'compute_filter.lhs':
            return _("What is the left hand side of the filter?");
        case 'compute_filter.rhs':
            return _("What is the right hand side of the filter?");

        default:
            // should never be hit, because all cases are covered, but who knows...
            return interpolate(_("What ${field:enum} would you like?"), {
                field: this._field
            });
        }
    }
    get() {
        return this._container[this._field];
    }
    set(value) {
        this._container[this._field] = value;
    }
}

export function makeScope(invocation) {
    // make out parameters available in the "scope", which puts
    // them as possible options for a later slot fill
    const schema = invocation.schema;
    if (!schema)
        return null;
    const scope = {};
    for (let argname in schema.out) {
        let argcanonical = schema.getArgCanonical(argname);

        let kind;
        if (invocation.isVarRef)
            kind = null;
        else
            kind = invocation.selector.kind;
        scope[argname] = {
            value: new Value.VarRef(argname),
            type: schema.out[argname],
            argcanonical: argcanonical,

            _prim: invocation,
            kind: kind,
            kind_canonical: schema.class ? (schema.class.metadata.canonical || null) : null,
        };
    }
    scope['$event'] = {
        value: new Value.Event(null),
        type: Type.String,
    };
    return scope;
}

export function* recursiveYieldArraySlots(slot) {
    // despite the name, this function also handles computation

    yield slot;
    const value = slot.get();
    if (value.isArray) {
        const type = slot.type;
        assert(type.isArray);
        for (let i = 0; i < value.value.length; i++)
            yield* recursiveYieldArraySlots(new ArrayIndexSlot(slot.primitive, slot.scope, type.elem, value.value, slot, i));
    } else if (value.isComputation) {
        const overload = value.overload || [];
        if (overload.length !== value.operands.length+1)
            console.error('Missing overload on computation value: ' + value);
        for (let i = 0; i < value.operands.length; i++)
            yield* recursiveYieldArraySlots(new ComputationOperandSlot(slot.primitive, slot.scope, overload[i] || Type.Any, value.op, value.operands, slot, i));
    }
}

/**
 * Type used by the old slot iteration API.
 *
 * This is actually a tuple but jsdoc does not understand tuples.
 * @typedef Ast~OldSlot
 * @property {Ast.ExpressionSignature} 0 - the signature of the nearest primitive
 * @property {Ast.InputParam|Ast.BooleanExpression.Atom} 1 - the holder of the value
 * @property {Ast.Invocation} 2 - the nearest primitive
 * @property {Object.<string, Ast~SlotScopeItem>} 3 - available names for parameter passing
 * @generator
 * @deprecated Use {@link Ast~AbstractSlot} and the new slot iteration API
 */

export function* iterateSlots2InputParams(prim, scope) {
    for (let in_param of prim.in_params) {
        const arg = prim.schema ? prim.schema.getArgument(in_param.name) : null;
        yield* recursiveYieldArraySlots(new InputParamSlot(prim, scope, arg, in_param));
    }
    return [prim, makeScope(prim)];
}
