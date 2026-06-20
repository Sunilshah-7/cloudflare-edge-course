#!/usr/bin/env bash
# Deploy with environment-aware canary rollout and health checks.

set -euo pipefail

ENVIRONMENT="${1:-staging}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-}"
HEALTH_CHECKS="${DEPLOY_HEALTH_CHECKS:-10}"
HEALTH_INTERVAL_SECONDS="${DEPLOY_HEALTH_INTERVAL_SECONDS:-3}"
PROPAGATION_SECONDS="${DEPLOY_PROPAGATION_SECONDS:-30}"
CANARY_PERCENT="${DEPLOY_CANARY_PERCENT:-10}"
VERSION_TAG="${DEPLOY_VERSION_TAG:-deploy-$(date -u +%Y%m%d%H%M%S)}"

case "$ENVIRONMENT" in
	staging)
		HEALTH_URL="${HEALTH_URL:-https://staging.example.com/health}"
		;;
	production)
		HEALTH_URL="${HEALTH_URL:-https://api.example.com/health}"
		;;
	*)
		echo "Unknown environment: $ENVIRONMENT" >&2
		echo "Expected one of: staging, production" >&2
		exit 2
		;;
esac

run_health_checks() {
	local label="$1"

	echo "Running health checks for $label at $HEALTH_URL..."
	for ((i = 1; i <= HEALTH_CHECKS; i++)); do
		local response
		response="$(curl -sS -o /dev/null -w "%{http_code}" "$HEALTH_URL")"
		if [[ "$response" != "200" ]]; then
			echo "Health check $i failed with HTTP $response" >&2
			return 1
		fi

		echo "Health check $i/$HEALTH_CHECKS passed"
		sleep "$HEALTH_INTERVAL_SECONDS"
	done
}

rollback_deployment() {
	echo "Rolling back latest $ENVIRONMENT deployment..."
	npx wrangler rollback --env "$ENVIRONMENT" --yes
}

echo "Building..."
npm run build

echo "Running tests..."
npm test

if [[ "$ENVIRONMENT" == "production" ]]; then
	echo "Uploading production version tagged $VERSION_TAG..."
	npx wrangler versions upload --env production --tag "$VERSION_TAG" --message "Canary upload $VERSION_TAG"

	echo "Deploying production canary at $CANARY_PERCENT%..."
	npx wrangler versions deploy --env production --version-tag "$VERSION_TAG" --percentage "$CANARY_PERCENT" --message "Canary $VERSION_TAG at $CANARY_PERCENT%" --yes

	echo "Waiting ${PROPAGATION_SECONDS}s for canary propagation..."
	sleep "$PROPAGATION_SECONDS"

	if ! run_health_checks "production canary"; then
		rollback_deployment
		exit 1
	fi

	echo "Promoting $VERSION_TAG to 100% production traffic..."
	npx wrangler versions deploy --env production --version-tag "$VERSION_TAG" --percentage 100 --message "Promote $VERSION_TAG" --yes
else
	echo "Deploying to $ENVIRONMENT..."
	npx wrangler deploy --env "$ENVIRONMENT"
fi

echo "Waiting ${PROPAGATION_SECONDS}s for propagation..."
sleep "$PROPAGATION_SECONDS"

if ! run_health_checks "$ENVIRONMENT"; then
	rollback_deployment
	exit 1
fi

echo "Deployment successful"
