"use strict";

const Q = require('q');
const fs = require('fs');

const AppGrammar = require('../lib/grammar_api');
const SchemaRetriever = require('../lib/schema');

const _mockSchemaDelegate = require('./mock_schema_delegate');
const _mockMemoryClient = require('./mock_memory_client');

const _schemaRetriever = new SchemaRetriever(_mockSchemaDelegate, _mockMemoryClient, true);

function main() {
    var code = fs.readFileSync('./test/sample.apps').toString('utf8').split('====');

    return Promise.all(code.map((code) => {
        code = code.trim();
        return AppGrammar.parseAndTypecheck(code, _schemaRetriever).then((program) => {
            if (code.indexOf(`** typecheck: expect `) >= 0) {
                console.error('Failed (expected error)');
                console.error(code);
            }

            try {
                Array.from(program.iterateSlots());
            } catch(e) {
                console.error('Iterate slots failed');
                console.log('Code:');
                console.log(code);
                console.error('====');
                console.error(e.stack);
                if (process.env.TEST_MODE)
                    throw e;
            }
        }, (e) => {
            if (code.indexOf(`** typecheck: expect ${e.name} **`) >= 0)
                return;
            console.error('Failed');
            console.error(code);
            console.error(e);
            if (process.env.TEST_MODE)
                throw e;
        });
    }));
}
module.exports = main;
if (!module.parent)
    main();
