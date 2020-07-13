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
const Ast = require('../ast');
const { NotImplementedError } = require('../errors');
const { getScalarExpressionName } = require('../utils');

const { PointWiseOp, StreamOp, TableOp, RuleOp, QueryInvocationHints } = require('./ops');
// YES there are two different modules called utils
// because of course
const { getDefaultProjection, getExpressionParameters } = require('./utils');
const ReduceOp = require('./reduceop');

function sameDevice(lhs, rhs) {
    assert(lhs.isDevice && rhs.isDevice);
    if (lhs.kind !== rhs.kind)
        return false;
    if (lhs.id !== rhs.id)
        return false;
    if (lhs.principal !== rhs.principal)
        return false;
    return true;
}


function addAll(set, values) {
    for (const v of values)
        set.add(v);
    return set;
}

function setIntersect(one, two) {
    const intersection = new Set;
    for (let el of one) {
        if (two.has(el))
            intersection.add(el);
    }
    return intersection;
}

function addMinimalProjection(args, schema) {
    args = new Set(args);
    addAll(args, schema.minimal_projection);
    return args;
}

/**
 * Lower the query invocation hints for one side of the join.
 *
 * This is a limited best-effort operation. optimize.js includes a more
 * thorough handling of filters and projections, which also affects
 * the JS compiled code.
 */
function restrictHintsForJoin(hints, schema) {
    // start with a clean slate (no sort, no index)
    const clone = new QueryInvocationHints(new Set);
    for (let arg of hints.projection) {
        if (schema.hasArgument(arg))
            clone.projection.add(arg);
    }
    clone.filter = (function recursiveHelper(expr) {
        if (expr.isTrue || expr.isFalse)
            return expr;
        if (expr.isDontCare) // dont care about dontcares
            return Ast.BooleanExpression.True;

        if (expr.isAtom) {
            // bail (convert to `true`) if:
            // - the filter left-hand-side is not defined in this branch of the join
            // - or any part of the right-hand-side uses a parameter not defined in this
            //   branch of the join

            if (!schema.hasArgument(expr.name))
                return Ast.BooleanExpression.True;

            const pnames = getExpressionParameters(expr.value);
            for (let pname of pnames) {
                if (!schema.hasArgument(pname))
                    return Ast.BooleanExpression.True;
            }

            return expr;
        }

        // ignore everything else
        return Ast.BooleanExpression.True;
    })(hints.filter);

    return clone;
}

// compile a table that is being monitored to a stream
function compileMonitorTableToOps(table, hints) {
    if (table.isVarRef ||
        table.isAlias)
        throw new NotImplementedError(table);

    if (table.isInvocation) {
        // subscribe is optimistic, we still need EdgeNew
        return new StreamOp.EdgeNew(
            new StreamOp.InvokeSubscribe(table.invocation, table, hints),
            table
        );
    } else if (table.isFilter) {
        const hintsclone = hints.clone();
        addAll(hintsclone.projection, getExpressionParameters(table.filter, table.schema));
        hintsclone.filter = new Ast.BooleanExpression.And(null, [table.filter, hints.filter]);
        return new StreamOp.Filter(
            compileMonitorTableToOps(table.table, hintsclone),
            table.filter,
            table
        );
    } else if (table.isProjection) {
        // see note in stream.isProjection later
        const effective = setIntersect(hints.projection, addMinimalProjection(table.args, table.schema));
        const hintsclone = hints.clone();
        hintsclone.projection = effective;

        // note the "edge new" operation here, because
        // the projection might cause fewer values to
        // be new
        return new StreamOp.EdgeNew(
            new StreamOp.Map(
                compileMonitorTableToOps(table.table, hintsclone),
                new PointWiseOp.Projection(effective),
                table
            ),
            table
        );
    } else if (table.isSort || table.isIndex || table.isSlice) {
        // sort, index and slice have no effect on monitor
        //
        // XXX is this correct?
        return compileMonitorTableToOps(table);
    } else if (table.isCompute) {
        const hintsclone = hints.clone();
        addAll(hintsclone.projection, getExpressionParameters(table.expression, table.schema));
        // note the "edge new" operation here, because
        // the projection might cause fewer values to
        // be new
        return new StreamOp.EdgeNew(
            new StreamOp.Map(
                compileMonitorTableToOps(table.table, hintsclone),
                new PointWiseOp.Compute(table.expression),
                table
            ),
            table
        );
    } else if (table.isAggregation) {
        // discard the hints entirely across aggregation
        const newHints = new QueryInvocationHints(table.field === '*' ? new Set([]) : new Set([table.field]));

        // for an aggregation, we subscribe to the inner table
        // (ie react to all changes), then when the table changes
        // we fetch it completely again and compute the aggregation
        // note the "edge new" operation here, because
        // the aggregation might cause fewer values to
        // be new
        return new StreamOp.EdgeNew(new StreamOp.InvokeTable(
            compileMonitorTableToOps(table.table, newHints),
            compileTableToOps(table, [], newHints),
            table
        ), table);
    } else if (table.isJoin) {
        if (table.in_params.length === 0) {
            // if there is no parameter passing, we can individually monitor
            // the two tables and return the union
            return new StreamOp.EdgeNew(new StreamOp.Union(
                compileMonitorTableToOps(table.lhs, restrictHintsForJoin(hints, table.lhs.schema)),
                compileMonitorTableToOps(table.rhs, restrictHintsForJoin(hints, table.rhs.schema)),
                table),
                table
            );
        } else {
            // otherwise we need to subscribe to the left hand side, and
            // every time it fires, create/update a subscription to the
            // right hand side
            // this is VERY MESSY
            // so it's not implemented
            throw new NotImplementedError(table);
        }
    } else {
        throw new TypeError();
    }
}

// compile a TT stream to a stream op and zero or more
// tableops
function compileStreamToOps(stream, hints) {
    if (stream.isAlias)
        throw new NotImplementedError(stream);

    if (stream.isVarRef) {
        return new StreamOp.InvokeVarRef(stream.name, stream.in_params, stream, hints);
    } else if (stream.isTimer) {
        return new StreamOp.Timer(stream.base, stream.interval, stream.frequency, stream);
    } else if (stream.isAtTimer) {
        return new StreamOp.AtTimer(stream.time, stream.expiration_date, stream);
    } else if (stream.isMonitor) {
        const hintsclone = hints.clone();
        // if we're monitoring on specific fields, we can project on those fields
        // otherwise, we need to project on all output parameters
        if (stream.args)
            addAll(hintsclone.projection, stream.args);
        else
            addAll(hintsclone.projection, Object.keys(stream.schema.out));
        return compileMonitorTableToOps(stream.table, hintsclone);
    } else if (stream.isEdgeNew) {
        let op = compileStreamToOps(stream.stream);
        return new StreamOp.EdgeNew(op, op.ast);
    } else if (stream.isEdgeFilter) {
        const hintsclone = hints.clone();
        addAll(hintsclone.projection, getExpressionParameters(stream.filter, stream.schema));
        // NOTE: we don't lower the filter here, because if the subscribe applies the filter,
        // we don't notice the edge
        //
        // we do it for StreamFilter, because Filter(Monitor) === Monitor(Filter)
        let op = compileStreamToOps(stream.stream, hintsclone);
        return new StreamOp.EdgeFilter(op, stream.filter, op.ast);
    } else if (stream.isFilter) {
        const hintsclone = hints.clone();
        addAll(hintsclone.projection, getExpressionParameters(stream.filter, stream.schema));
        hintsclone.filter = new Ast.BooleanExpression.And(null, [stream.filter, hints.filter]);
        let op = compileStreamToOps(stream.stream, hintsclone);
        return new StreamOp.Filter(op, stream.filter, op.ast);
    } else if (stream.isProjection) {
        // NOTE: there is a tricky case of nested projection that looks like
        // Projection(Filter(Projection(x, [a, b, c]), use(c)), [a, b])
        //
        // This is dangerous because the PointWiseOp.Projection will hard-apply
        // the projection, it won't be just a hint. Yet, it is ok
        // because all parameters that are used by the filter are added to the
        // projection hint.
        const effective = setIntersect(hints.projection, addMinimalProjection(stream.args, stream.schema));
        const hintsclone = hints.clone();
        hintsclone.projection = effective;
        let op = compileStreamToOps(stream.stream, hintsclone);
        return new StreamOp.Map(op, new PointWiseOp.Projection([...effective]), op.ast);
    } else if (stream.isCompute) {
        const hintsclone = hints.clone();
        addAll(hintsclone.projection, getExpressionParameters(stream.filter, stream.schema));
        let op = compileStreamToOps(stream.stream, hintsclone);
        return new StreamOp.Map(op, new PointWiseOp.Compute(stream.expression,
            stream.alias || getScalarExpressionName(stream.expression)), op.ast);
    } else if (stream.isJoin) {
        let streamOp = compileStreamToOps(stream.stream, restrictHintsForJoin(hints, stream.stream.schema));
        let tableOp = compileTableToOps(stream.table, stream.in_params, restrictHintsForJoin(hints, stream.table.schema));
        return new StreamOp.Join(streamOp, tableOp, stream);
    } else {
        throw new TypeError();
    }
}

function compileTableToOps(table, extra_in_params, hints) {
    if (table.isAlias)
        throw new NotImplementedError(table);

    if (table.isVarRef) {
        const compiled = new TableOp.InvokeVarRef(table.name, table.in_params.concat(extra_in_params), table, hints);
        compiled.device = null;
        compiled.handle_thingtalk = false;
        return compiled;
    } else if (table.isInvocation) {
        const device = table.invocation.selector;
        const handle_thingtalk = table.schema.annotations['handle_thingtalk'] ? table.schema.annotations['handle_thingtalk'].value : false;
        return new TableOp.InvokeGet(
            table.invocation,
            extra_in_params,
            device,
            handle_thingtalk,
            table,
            hints
        );
    } else if (table.isFilter) {
        const hintsclone = hints.clone();
        addAll(hintsclone.projection, getExpressionParameters(table.filter, table.schema));
        hintsclone.filter = new Ast.BooleanExpression.And(null, [table.filter, hints.filter]);
        const compiled = compileTableToOps(table.table, extra_in_params, hintsclone);
        return new TableOp.Filter(
            compiled,
            table.filter,
            compiled.device,
            compiled.handle_thingtalk,
            table
        );
    } else if (table.isProjection) {
        // see note above (for stream.isProjection) for this operation
        const effective = setIntersect(hints.projection, addMinimalProjection(table.args, table.schema));
        const hintsclone = hints.clone();
        hintsclone.projection = effective;

        const compiled = compileTableToOps(table.table, extra_in_params, hintsclone);
        return new TableOp.Map(
            compiled,
            new PointWiseOp.Projection(effective),
            compiled.device,
            compiled.handle_thingtalk,
            table
        );
    } else if (table.isCompute) {
        const hintsclone = hints.clone();
        addAll(hintsclone.projection, getExpressionParameters(table.expression, table.schema));
        const compiled = compileTableToOps(table.table, extra_in_params, hintsclone);
        return new TableOp.Map(
            compiled,
            new PointWiseOp.Compute(table.expression,
                table.alias || getScalarExpressionName(table.expression)),
            compiled.device,
            compiled.handle_thingtalk,
            table
        );
    } else if (table.isAggregation) {
        // discard the hints entirely across aggregation
        const newHints = new QueryInvocationHints(table.field === '*' ? new Set([]) : new Set([table.field]));

        let reduceop;
        if (table.operator === 'count' && table.field === '*')
            reduceop = new ReduceOp.Count;
        else if (table.operator === 'count')
            reduceop = new ReduceOp.CountDistinct(table.field);
        else if (table.operator === 'avg')
            reduceop = new ReduceOp.Average(table.field, table.schema.out[table.field]);
        else
            reduceop = new ReduceOp.SimpleAggregation(table.operator, table.field, table.schema.out[table.field]);

        const compiled = compileTableToOps(table.table, extra_in_params, newHints);
        return new TableOp.Reduce(
            compiled,
            reduceop,
            compiled.device,
            compiled.handle_thingtalk,
            table
        );
    } else if (table.isIndex && table.indices.length === 1 && table.indices[0].isNumber && table.table.isSort) {
        const hintsclone = hints.clone();

        // convert sort followed by a single index into argminmax
        let reduceop;
        if (table.indices[0].value === 1 || table.indices[0].value === -1) {
            // common case of simple argmin/argmax
            let argminmaxop;
            if ((table.indices[0].value === 1 && table.table.direction === 'asc') ||
                (table.indices[0].value === -1 && table.table.direction === 'desc'))
                argminmaxop = 'argmin';
            else
                argminmaxop = 'argmax';

            hintsclone.limit = 1;
            hintsclone.sort = [table.table.field, table.table.direction];
            reduceop = new ReduceOp.SimpleArgMinMax(argminmaxop, table.table.field);
        } else {
            let argminmaxop;
            if (table.table.direction === 'asc')
                argminmaxop = 'argmin';
            else
                argminmaxop = 'argmax';

            // across an index, the limit hint becomes the index value, if known,
            // (so an index [3] would fetch 3 elements)
            //
            // NOTE: for correct operation, devices which implement hints MUST NOT
            // implement "limit" without implementing "sort"
            hintsclone.limit = table.indices[0].toJS();
            hintsclone.sort = [table.table.field, table.table.direction];
            reduceop = new ReduceOp.ComplexArgMinMax(argminmaxop, table.table.field, table.indices[0], new Ast.Value.Number(1));
        }

        const compiled = compileTableToOps(table.table.table, extra_in_params, hintsclone);
        return new TableOp.Reduce(
            compiled,
            reduceop,
            compiled.device,
            compiled.handle_thingtalk,
            table
        );
    } else if (table.isSlice && table.table.isSort) {
        // convert sort followed by a single slice into argminmax
        let argminmaxop;
        if (table.table.direction === 'asc')
            argminmaxop = 'argmin';
        else
            argminmaxop = 'argmax';
        let reduceop = new ReduceOp.ComplexArgMinMax(argminmaxop, table.table.field, table.base, table.limit);

        const hintsclone = hints.clone();
        // across a slice, the limit hint becomes the base value + the limit value, if known,
        // (so a slice [2:3] would fetch 4 elements, and then discard the first one)
        // (note the off by one because the base is 1-based)
        //
        // NOTE: for correct operation, devices which implement hints MUST NOT
        // implement "limit" without implementing "sort"
        hintsclone.limit = table.base.isNumber && table.limit.isNumber ?
            (table.base.toJS() - 1 + table.limit.toJS()) : undefined;
        hintsclone.sort = [table.table.field, table.table.direction];

        const compiled = compileTableToOps(table.table.table, extra_in_params, hintsclone);
        return new TableOp.Reduce(
            compiled,
            reduceop,
            compiled.device,
            compiled.handle_thingtalk,
            table
        );
    } else if (table.isSort) {
        const hintsclone = hints.clone();
        hintsclone.sort = [table.field, table.direction];
        const compiled = compileTableToOps(table.table, extra_in_params, hintsclone);
        return new TableOp.Reduce(
            compiled,
            new ReduceOp.Sort(table.field, table.direction),
            compiled.device,
            compiled.handle_thingtalk,
            table
        );
    } else if (table.isIndex && table.indices.length === 1 && table.indices[0].isNumber && table.indices[0].value > 0) {
        // across an index, the limit hint becomes the index value, if known,
        // (so an index [3] would fetch 3 elements)
        //
        // NOTE: for correct operation, devices which implement hints MUST NOT
        // implement "limit" without implementing "sort"
        const hintsclone = hints.clone();
        hintsclone.limit = table.indices[0].toJS();
        const compiled = compileTableToOps(table.table, extra_in_params, hintsclone);
        return new TableOp.Reduce(
            compiled,
            new ReduceOp.SimpleIndex(table.indices[0]),
            compiled.device,
            compiled.handle_thingtalk,
            table
        );
    } else if (table.isIndex) {
        // if the index is not constant, we just discard it
        const hintsclone = hints.clone();
        hintsclone.index = undefined;
        const compiled = compileTableToOps(table.table, extra_in_params, hintsclone);
        return new TableOp.Reduce(
            compiled,
            new ReduceOp.ComplexIndex(table.indices),
            compiled.device,
            compiled.handle_thingtalk,
            table
        );
    } else if (table.isSlice) {
        const hintsclone = hints.clone();
        // across a slice, the limit hint becomes the base value + the limit value, if known,
        // (so a slice [2:3] would fetch 4 elements, and then discard the first one)
        // (note the off by one because the base is 1-based)
        //
        // NOTE: for correct operation, devices which implement hints MUST NOT
        // implement "limit" without implementing "sort"
        hintsclone.limit = table.base.isNumber && table.limit.isNumber ?
            (table.base.toJS() - 1 + table.limit.toJS()) : undefined;

        const compiled = compileTableToOps(table.table, extra_in_params, hintsclone);
        return new TableOp.Reduce(
            compiled,
            new ReduceOp.Slice(table.base, table.limit),
            compiled.device,
            compiled.handle_thingtalk,
            table
        );
    } else if (table.isJoin) {
        if (table.in_params.length === 0) {
            const lhs = compileTableToOps(table.lhs, extra_in_params, restrictHintsForJoin(hints, table.lhs.schema));
            const rhs = compileTableToOps(table.rhs, extra_in_params, restrictHintsForJoin(hints, table.rhs.schema));
            let invocation = null;
            let handle_thingtalk = false;
            if (lhs.device && rhs.device) {
                invocation = sameDevice(lhs.device, rhs.device) ? lhs.device : null;
                handle_thingtalk = sameDevice(lhs.device, rhs.device) ? lhs.handle_thingtalk && rhs.handle_thingtalk : false;
            }

            return new TableOp.CrossJoin(lhs, rhs, invocation, handle_thingtalk, table);
        } else {
            let lhs_in_params = [];
            let rhs_in_params = [];
            for (let in_param of extra_in_params) {
                if (in_param.name in table.lhs.schema.inReq ||
                    in_param.name in table.lhs.schema.inOpt)
                    lhs_in_params.push(in_param);
                if (in_param.name in table.rhs.schema.inReq ||
                    in_param.name in table.rhs.schema.inOpt)
                    rhs_in_params.push(in_param);
            }

            const lhs = compileTableToOps(table.lhs, lhs_in_params, restrictHintsForJoin(hints, table.lhs.schema));
            const rhs = compileTableToOps(table.rhs, rhs_in_params.concat(table.in_params), restrictHintsForJoin(hints, table.rhs.schema));
            const device = sameDevice(lhs.device, rhs.device) ? lhs.device : null;
            const handle_thingtalk = sameDevice(lhs.device, rhs.device) ? lhs.handle_thingtalk && rhs.handle_thingtalk : false;

            return new TableOp.NestedLoopJoin(lhs, rhs, device, handle_thingtalk, table);
        }
    } else {
        throw new TypeError();
    }
}

function optimizeStreamOp(streamop, hasOutputAction) {
    // optimize edgenew of edgenew
    if (streamop.isEdgeNew && streamop.stream.isEdgeNew)
        return optimizeStreamOp(streamop.stream);

    // remove projection if there is no "notify;"
    if (!hasOutputAction && streamop.isMap && streamop.op.isProjection)
        return optimizeStreamOp(streamop.stream, hasOutputAction);

    // optimize projection of projection
    if (streamop.isMap && streamop.op.isProjection &&
        streamop.stream.isMap && streamop.stream.op.isProjection) {
        // bypass the inner projection, as the outer one subsumes it
        streamop.stream = optimizeStreamOp(streamop.stream.stream, hasOutputAction);
        return streamop;
    }

    if (streamop.isInvokeTable || streamop.isJoin) {
        streamop.stream = optimizeStreamOp(streamop.stream, hasOutputAction);
        streamop.table = optimizeTableOp(streamop.table, hasOutputAction);
        return streamop;
    }

    if (streamop.stream) {
        streamop.stream = optimizeStreamOp(streamop.stream, hasOutputAction);
        return streamop;
    }

    return streamop;
}
function optimizeTableOp(tableop, hasOutputAction) {
    // remove projection if there is no "notify;"
    if (!hasOutputAction && tableop.isMap && tableop.op.isProjection)
        return optimizeTableOp(tableop.table, hasOutputAction);

    // optimize projection of projection
    if (tableop.isMap && tableop.op.isProjection &&
        tableop.table.isMap && tableop.table.op.isProjection) {
        // bypass the inner projection, as the outer one subsumes it
        tableop.table = optimizeTableOp(tableop.table.table, hasOutputAction);
        return tableop;
    }

    if (tableop.isCrossJoin || tableop.isNestedLoopJoin) {
        tableop.lhs = optimizeTableOp(tableop.lhs, hasOutputAction);
        tableop.rhs = optimizeTableOp(tableop.rhs, hasOutputAction);
        return tableop;
    }

    if (tableop.table) {
        tableop.table = optimizeTableOp(tableop.table, hasOutputAction);
        return tableop;
    }

    return tableop;
}

function getStatementSchema(statement) {
    if (statement.isRule)
        return statement.stream.schema;
    else if (statement.table)
        return statement.table.schema;
    else
        return null;
}

// compile a rule/command statement to a RuleOp
function compileStatementToOp(statement) {
    let statementSchema = getStatementSchema(statement);

    let hasDefaultProjection = statementSchema && statementSchema.default_projection && statementSchema.default_projection.length > 0;
    let default_projection = getDefaultProjection(statementSchema);
    let projection = new Set;

    let hasOutputAction = false;
    if (statementSchema) {
        statement.actions.forEach((action) => {
            if (action.isNotify) {
                hasOutputAction = true;
                addAll(projection, default_projection);
            } else if (action.isInvocation) {
                action.invocation.in_params.forEach((p) => {
                    addAll(projection, getExpressionParameters(p.value, statementSchema));
                });
            } else {
                action.in_params.forEach((p) => {
                    addAll(projection, getExpressionParameters(p.value, statementSchema));
                });
            }
        });
    }

    let streamop;
    if (statement.isRule) {
        streamop = compileStreamToOps(statement.stream, new QueryInvocationHints(projection));
        // if there is no #[default_projection] annotation, we don't bother with a projection operation,
        // the result will contain the right parameters already
        if (hasDefaultProjection) {
            streamop = new StreamOp.Map(
                streamop,
                new PointWiseOp.Projection(projection),
                new Ast.Stream.Projection(null, statement.stream, [...projection], statement.stream.schema)
            );
        }
    } else if (statement.table) {
        let tableop = compileTableToOps(statement.table, [], new QueryInvocationHints(projection));
        // if there is no #[default_projection] annotation, we don't bother with a projection operation,
        // the result will contain the right parameters already
        if (hasDefaultProjection) {
            let newtable = new Ast.Table.Projection(null, statement.table, [...projection], statement.table.schema);
            tableop = new TableOp.Map(
                tableop,
                new PointWiseOp.Projection(projection),
                tableop.device,
                tableop.handle_thingtalk,
                newtable
            );
            streamop = new StreamOp.Join(StreamOp.Now, tableop, newtable);
        } else {
            streamop = new StreamOp.Join(StreamOp.Now, tableop, statement.table);
        }
    } else {
        streamop = StreamOp.Now;
    }

    streamop = optimizeStreamOp(streamop, hasOutputAction);

    return new RuleOp(streamop, statement.actions, statement);
}

module.exports = {
    compileStatementToOp,
    compileStreamToOps,
    compileTableToOps
};
