SHELL := /bin/bash

.PHONY: help install dev build start lint typecheck test verify run-wasm-chat-history clean

WASM_WORKFLOW_YAML ?= examples/email-chat-draft-or-clarify.yaml
WASM_CHAT_FLAGS ?=

help:
	@printf "YamSLAM make targets:\n"
	@printf "  make install     Install dependencies\n"
	@printf "  make dev         Start local dev server\n"
	@printf "  make lint        Run ESLint checks\n"
	@printf "  make typecheck   Run TypeScript checks\n"
	@printf "  make test        Run quick validation (lint + typecheck)\n"
	@printf "  make build       Build production bundle\n"
	@printf "  make verify      Run lint + typecheck + build\n"
	@printf "  make run-wasm-chat-history Run wasm workflow chat-history quick check\n"
	@printf "  make start       Start production server\n"
	@printf "  make clean       Remove local build artifacts\n"

install:
	npm install

dev:
	npm run dev

build:
	npm run build

start:
	npm run start

lint:
	npm run lint

typecheck:
	npm run typecheck

test: lint typecheck

verify: lint typecheck build

run-wasm-chat-history:
	@set -a; \
	if [ -f ".env" ]; then . ".env"; fi; \
	set +a; \
	node examples/run_wasm_chat_history.mjs --workflow $(WASM_WORKFLOW_YAML) $(WASM_CHAT_FLAGS)

clean:
	rm -rf .next
