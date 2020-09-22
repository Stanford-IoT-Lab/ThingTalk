// -*- mode: ts; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2017-2018 The Board of Trustees of the Leland Stanford Junior University
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

import { isUnaryStreamToStreamOp,
         isUnaryTableToTableOp,
         isUnaryStreamToTableOp,
         isUnaryTableToStreamOp } from './utils';

// Initialize the AST API
import { notifyAction } from './ast/api';

import { typeCheckFilter, typeCheckProgram, typeCheckPermissionRule } from './typecheck';

export {
    notifyAction,

    // recursive utilities
    isUnaryTableToTableOp,
    isUnaryStreamToTableOp,
    isUnaryStreamToStreamOp,
    isUnaryTableToStreamOp,

    // legacy API
    typeCheckFilter,
    typeCheckProgram,
    typeCheckPermissionRule
};