// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import assert from 'assert';

import * as Ast from '../ast';
import type * as builtin from '../builtin/values';

type PlainObject = { [key : string] : unknown };
type CompiledDeviceAttributes = { [key : string] : string };
type CompiledParams = { [key : string] : unknown };

type CompiledFilterHint = [string, string, unknown];

interface CompiledQueryHints {
    filter ?: CompiledFilterHint[];
    sort ?: [string, 'asc' | 'desc'];
    projection ?: string[];
    limit ?: number;
}

interface StreamValue {
    [key : string] : unknown;
    __timestamp : number;
}

export default abstract class ExecEnvironment {
    // this is accessed from compiled ThingTalk code
    _scope : { [key : string] : any };

    private _procedureFrameCounter : number;
    private _procedureFrame : number;
    private _procedureStack : number[];

    constructor() {
        this._scope = {};

        this._procedureFrameCounter = 0;
        this._procedureFrame = 0;
        this._procedureStack = [];
    }

    /* istanbul ignore next */
    get program_id() : builtin.Entity {
        throw new Error('Must be overridden');
    }

    /**
     * Returns a unique id of the current stack frame.
     *
     * The ID is incremented for every procedure call.
     */
    get procedureFrame() : number {
        return this._procedureFrame;
    }

    enterProcedure(procid : number, procname : string) : void {
        // save the calling frame ID on the stack
        this._procedureStack.push(this._procedureFrame);

        // make a fresh ID for the new call
        this._procedureFrameCounter++;
        this._procedureFrame = this._procedureFrameCounter;
    }
    exitProcedure(procid : number, procname : string) : void {
        // check that enter & exit are correctly paired
        assert(this._procedureStack.length > 0);

        // restore the frame ID of the caller from the stack
        this._procedureFrame = this._procedureStack.pop() as number;
    }

    /* istanbul ignore next */
    invokeMonitor(kind : string,
                  attrs : CompiledDeviceAttributes,
                  fname : string,
                  params : CompiledParams,
                  hints : CompiledQueryHints) : AsyncIterator<[string, StreamValue]> {
        throw new Error('Must be overridden');
    }
    /* istanbul ignore next */
    invokeTimer(base : Date,
                interval : number,
                frequency : number) : AsyncIterator<StreamValue> {
        throw new Error('Must be overridden');
    }
    /* istanbul ignore next */
    invokeAtTimer(timeArray : builtin.Time[],
                  expiration_date ?: Date) : AsyncIterator<StreamValue> {
        throw new Error('Must be overridden');
    }
    /* istanbul ignore next */
    invokeQuery(kind : string,
                attrs : CompiledDeviceAttributes,
                fname : string,
                params : CompiledParams,
                hints : CompiledQueryHints) : AsyncIterable<[string, PlainObject]> {
        throw new Error('Must be overridden');
    }
    /* istanbul ignore next */
    invokeDBQuery(kind : string,
                  attrs : CompiledDeviceAttributes,
                  query : Ast.Program) : AsyncIterable<[string, PlainObject]> {
        throw new Error('Must be overridden');
    }
    /* istanbul ignore next */
    invokeAction(kind : string,
                 attrs : CompiledDeviceAttributes,
                 fname : string,
                 params : CompiledParams) : AsyncIterable<[string, PlainObject]> {
        throw new Error('Must be overridden');
    }
    /* istanbul ignore next */
    clearGetCache() : void {
        throw new Error('Must be overridden');
    }

    /* istanbul ignore next */
    sendEndOfFlow(principal : string, flow : number) : Promise<void> {
        throw new Error('Must be overridden');
    }
    /* istanbul ignore next */
    output(outputType : string, output : PlainObject) : Promise<void> {
        throw new Error('Must be overridden');
    }

    /* istanbul ignore next */
    readState(stateId : number) : Promise<unknown> {
        throw new Error('Must be overridden');
    }
    /* istanbul ignore next */
    writeState(stateId : number, value : unknown) : Promise<void> {
        throw new Error('Must be overridden');
    }
    /* istanbul ignore next */
    reportError(message : string, err : Error) : Promise<void> {
        throw new Error('Must be overridden');
    }

    formatEvent(outputType : string, output : PlainObject, hint : string) : Promise<string> {
        throw new Error('Must be overridden');
    }
}
