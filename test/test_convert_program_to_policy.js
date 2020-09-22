// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2018-2019 The Board of Trustees of the Leland Stanford Junior University
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

const Q = require('q');
Q.longStackSupport = true;
const Grammar = require('../lib/grammar_api');
const SchemaRetriever = require('../lib/schema').default;

const _mockSchemaDelegate = require('./mock_schema_delegate');
const schemaRetriever = new SchemaRetriever(_mockSchemaDelegate, null, true);

var TEST_CASES = [
    // manually written test cases
    ['now => @com.twitter.post();',
     'source == "test-account:foobar"^^tt:contact("Bob") : now => @com.twitter.post;'],
    [`now => @com.twitter.post(status="foo");`,
     'source == "test-account:foobar"^^tt:contact("Bob") : now => @com.twitter.post, status == "foo";'],

    [`now => @com.twitter.search(), text =~ "lol" => @com.twitter.post(status=text);`,
     'source == "test-account:foobar"^^tt:contact("Bob") : @com.twitter.search, text =~ "lol" => @com.twitter.post, status == text;'],
    [`now => @com.bing.web_search(query="lol") => @com.twitter.post(status=description);`,
     'source == "test-account:foobar"^^tt:contact("Bob") : @com.bing.web_search, query == "lol" => @com.twitter.post, status == description;'],
    [`now => @com.bing.web_search(query="lol"), description =~ "bar" => @com.twitter.post(status=description);`,
     'source == "test-account:foobar"^^tt:contact("Bob") : @com.bing.web_search, (query == "lol" && description =~ "bar") => @com.twitter.post, status == description;'],
    [`monitor @com.bing.web_search(query="lol") => @com.twitter.post(status=description);`,
     'source == "test-account:foobar"^^tt:contact("Bob") : @com.bing.web_search, query == "lol" => @com.twitter.post, status == description;'],
    [`monitor @com.bing.web_search(query="lol"), description =~ "bar" => @com.twitter.post(status=description);`,
     'source == "test-account:foobar"^^tt:contact("Bob") : @com.bing.web_search, (query == "lol" && description =~ "bar") => @com.twitter.post, status == description;'],
    [`monitor (@com.bing.web_search(query="lol"), description =~ "bar") => @com.twitter.post(status=description);`,
     'source == "test-account:foobar"^^tt:contact("Bob") : @com.bing.web_search, (query == "lol" && description =~ "bar") => @com.twitter.post, status == description;'],

    [`now => @com.twitter.search(), text =~ "lol" => notify;`,
     'source == "test-account:foobar"^^tt:contact("Bob") : @com.twitter.search, text =~ "lol" => notify;'],
    [`now => @com.bing.web_search(query="lol") => notify;`,
     'source == "test-account:foobar"^^tt:contact("Bob") : @com.bing.web_search, query == "lol" => notify;'],
    [`now => @com.bing.web_search(query="lol"), description =~ "bar" => notify;`,
     'source == "test-account:foobar"^^tt:contact("Bob") : @com.bing.web_search, (query == "lol" && description =~ "bar") => notify;'],
    [`monitor @com.bing.web_search(query="lol") => notify;`,
     'source == "test-account:foobar"^^tt:contact("Bob") : @com.bing.web_search, query == "lol" => notify;'],
    [`monitor @com.bing.web_search(query="lol"), description =~ "bar" => notify;`,
     'source == "test-account:foobar"^^tt:contact("Bob") : @com.bing.web_search, (query == "lol" && description =~ "bar") => notify;'],
    [`monitor (@com.bing.web_search(query="lol"), description =~ "bar") => notify;`,
     'source == "test-account:foobar"^^tt:contact("Bob") : @com.bing.web_search, (query == "lol" && description =~ "bar") => notify;'],
];

function test(i) {
    console.log('Test Case #' + (i+1));
    var [code, expected] = TEST_CASES[i];

    return Grammar.parseAndTypecheck(code, schemaRetriever, true).then((prog) => {
        let rule = prog.convertToPermissionRule('test-account:foobar', 'Bob');
        let tt = rule.prettyprint(true);

        if (expected !== tt) {
            console.error('Test Case #' + (i+1) + ': does not match what expected');
            console.error('Expected: ' + expected);
            console.error('Generated: ' + tt);
            if (process.env.TEST_MODE)
                throw new Error(`testDeclarationProgram ${i+1} FAILED`);
        }
    }).catch((e) => {
        console.error('Test Case #' + (i+1) + ': failed with exception');
        console.error('Error: ' + e.message);
        console.error(e.stack);
        if (process.env.TEST_MODE)
            throw e;
    });
}

function loop(i) {
    if (i === TEST_CASES.length)
        return Q();

    return Q(test(i)).then(() => loop(i+1));
}

function main() {
    return loop(0);
}
module.exports = main;
if (!module.parent)
    main();
