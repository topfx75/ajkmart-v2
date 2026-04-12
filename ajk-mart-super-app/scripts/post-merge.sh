#!/bin/bash
set -e
pnpm install --frozen-lockfile
echo "1" | pnpm --filter @workspace/db push-force
