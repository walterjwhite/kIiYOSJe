#!/bin/sh

npm install
npx tsc --build packages/core packages/pipeline packages/server packages/cli
