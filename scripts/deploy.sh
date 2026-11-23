#!/usr/bin/env bash
# Upload site/ to S3 with explicit content types and cache headers, then invalidate CloudFront.
#
# Usage:
#   BUCKET=<bucket-name> DISTRIBUTION_ID=<distribution-id> ./scripts/deploy.sh            # whole site
#   BUCKET=<bucket-name> DISTRIBUTION_ID=<distribution-id> ./scripts/deploy.sh index.html # selected files
#
# Requires AWS CLI v2 and credentials that can write to the bucket and create invalidations.
# resume.pdf is published separately and is not tracked in git.
set -euo pipefail
: "${BUCKET:?set BUCKET}"
: "${DISTRIBUTION_ID:?set DISTRIBUTION_ID}"
cd "$(dirname "$0")/../site"

if [ "$#" -eq 0 ]; then
  mapfile -t files < <(find . -type f ! -name resume.pdf | sed 's#^\./##' | sort)
else
  files=("$@")
fi

paths=()
for f in "${files[@]}"; do
  case "$f" in
    *.html)  ct="text/html; charset=utf-8";       cc="public,max-age=300" ;;
    *.js)    ct="text/javascript; charset=utf-8"; cc="public,max-age=3600" ;;
    *.svg)   ct="image/svg+xml";                  cc="public,max-age=3600" ;;
    *.txt)   ct="text/plain; charset=utf-8";      cc="public,max-age=86400" ;;
    *.xml)   ct="application/xml";                cc="public,max-age=86400" ;;
    *.woff2) ct="font/woff2";                     cc="public,max-age=604800" ;;
    *.webp)  ct="image/webp";                     cc="public,max-age=86400" ;;
    *.png)   ct="image/png";                      cc="public,max-age=86400" ;;
    *.pdf)   ct="application/pdf";                cc="public,max-age=300" ;;
    *)       ct="application/octet-stream";       cc="public,max-age=86400" ;;
  esac
  aws s3 cp "$f" "s3://$BUCKET/$f" --content-type "$ct" --cache-control "$cc" --only-show-errors
  echo "uploaded $f"
  paths+=("/$f")
  if [ "$f" = "index.html" ]; then paths+=("/"); fi
done

if [ "$#" -eq 0 ]; then paths=("/*"); fi
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "${paths[@]}" \
  --query Invalidation.Id --output text
