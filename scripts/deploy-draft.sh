#!/usr/bin/env bash
# Draft (non-production) Netlify deploy from a clean staging copy with NO .env files,
# so secrets come only from Netlify's environment. The private seed cache is included.
#   scripts/deploy-draft.sh            -> draft URL
#   scripts/deploy-draft.sh --prod     -> production (only with explicit approval)
set -euo pipefail
SITE_ID="da72bd44-ab50-4789-a71f-bd053d7f8b2a"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)/territory"
rsync -a --exclude '.env*' --exclude '.next' --exclude '.netlify' --exclude 'submission' --exclude 'test-results' \
  --exclude '.private/*.json' "$SRC/" "$STAGE/"
cp "$SRC/.env.example" "$STAGE/.env.example"
if find "$STAGE" -name '.env*' ! -name '.env.example' | grep -q .; then echo "refusing: env file in staging copy" >&2; exit 1; fi
cd "$STAGE"
npx netlify-cli deploy --build --site "$SITE_ID" --message "territory $(git -C "$SRC" rev-parse --short HEAD)" --json "$@" > "$SRC/.netlify-deploy.json"
if find .netlify -name '.env*' ! -name '.env.example' | grep -q .; then echo "WARNING: env file found in built bundle" >&2; exit 1; fi
python3 -c "import json;d=json.load(open('$SRC/.netlify-deploy.json'));print(d.get('deploy_url'))"
