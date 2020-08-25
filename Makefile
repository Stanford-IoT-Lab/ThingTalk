%.js : %.lr tools/generate-parser/*.js tools/generate-parser/grammar.js
	node tools/generate-parser $@ $<
	node -c $@

%.js : %.pegjs
	pegjs -o $@ $<

%.mo : %.po
	msgfmt $< -o $@

all = \
	$(patsubst %.po,%.mo,$(wildcard po/*.po)) \
	tools/generate-parser/grammar.js \
	lib/nn-syntax/parser.js \
	lib/grammar.js \
	test/test_sr_parser_generator.js

all: $(all)

lib/grammar.js : lib/grammar.pegjs
	pegjs --allowed-start-rules input,type_ref,permission_rule -o $@ $<
