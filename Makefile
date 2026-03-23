SHELL := /bin/bash

.PHONY: help install dev build start lint typecheck test verify clean

help:
	@printf "YamSLAM make targets:\n"
	@printf "  make install     Install dependencies\n"
	@printf "  make dev         Start local dev server\n"
	@printf "  make lint        Run ESLint checks\n"
	@printf "  make typecheck   Run TypeScript checks\n"
	@printf "  make test        Run quick validation (lint + typecheck)\n"
	@printf "  make build       Build production bundle\n"
	@printf "  make verify      Run lint + typecheck + build\n"
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

clean:
	rm -rf .next
