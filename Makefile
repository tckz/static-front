.PHONY: all version clean

VERSION := $(shell node -e "console.log(require('./package.json').version)")
REVISION := $(shell git show -s --format=%h)

TARGETS = dist/static-front-auth.zip
LIBS := $(shell find lib -type f)

all: version $(TARGETS)
	@echo $@ done.

version: 
	printf '{"version": "$(VERSION)",\n "revision": "$(REVISION)"}\n' > version.json

clean:
	/bin/rm -f $(TARGETS)
	@echo $@ done.

dist/static-front-auth.zip: index.js $(LIBS) yarn.lock node_modules/.yarn-integrity
	/bin/rm -f $@
	zip -q -r $@ $^ node_modules/ version.json config/default.yaml

