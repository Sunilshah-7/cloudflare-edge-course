/**
 * Feature Flag Utility for Cloudflare Workers
 *
 * Provides a pattern for feature flags with:
 * 1. Primary storage in Workers KV
 * 2. Fallback to origin config service
 * 3. Automatic caching in KV with TTL
 *
 * Usage:
 *   const isEnabled = await isFeatureFlagEnabled(env.FEATURE_FLAGS, 'feature-name', request, false);
 *
 *   // For percentage rollouts or targeting:
 *   const isEnabled = await isFeatureFlagEnabled(env.FEATURE_FLAGS, 'feature-name', request,
 *     {
 *       defaultValue: false,
 *       rolloutPercentage: 50,
 *       targeting: {
 *         countries: ['US', 'CA', 'UK'],
 *         deviceTypes: ['mobile']
 *       }
 *     }
 *   );
 */

interface FeatureFlagOptions {
  defaultValue?: boolean;
  rolloutPercentage?: number; // 0-100
  targeting?: {
    countries?: string[]; // ISO country codes
    deviceTypes?: string[]; // 'mobile', 'desktop'
    // Add more targeting criteria as needed
  };
  cacheTtlSeconds?: number; // Default to 1 hour
}

/**
 * Generate a consistent hash for rollout percentage targeting
 * @param value String to hash (e.g., user ID, request ID, IP)
 * @param max Maximum value for hash range
 * @returns Number between 0 and max-1
 */
function simpleHash(value: string, max: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % max;
}

/**
 * Check if a feature flag is enabled for a given request
 *
 * @param flagsKV KV namespace binding for feature flags
 * @param flagKey Key for the feature flag (e.g., 'feature:new-checkout')
 * @param request Incoming request object for context
 * @param options Configuration options for the flag
 * @returns Promise resolving to boolean indicating if flag is enabled
 */
export async function isFeatureFlagEnabled(
  flagsKV: KVNamespace,
  flagKey: string,
  request: Request,
  options: FeatureFlagOptions = {}
): Promise<boolean> {
  const {
    defaultValue = false,
    rolloutPercentage,
    targeting,
    cacheTtlSeconds = 3600 // 1 hour default
  } = options;

  // Construct KV key
  const kvKey = `feature:${flagKey}`;

  try {
    // 1. Check KV cache first
    let enabled = await flagsKV.get(kvKey);

    if (enabled !== null) {
      // Cached value found - parse and evaluate
      const flagConfig = JSON.parse(enabled);
      return evaluateFlag(flagConfig, request, options);
    }

    // 2. KV miss - fetch from origin config service
    const configResp = await fetch(
      `https://config.example.com/flags/${flagKey}`,
      {
        headers: {
          'Accept': 'application/json',
          // Pass along useful headers for origin to make decisions
          'CF-IPCountry': String(request.cf?.country || ''),
          'User-Agent': request.headers.get('User-Agent') || ''
        }
      }
    );

    if (!configResp.ok) {
      // Origin failed - fall back to default
      console.warn(`Feature flag config fetch failed for ${flagKey}: ${configResp.status}`);
      return defaultValue;
    }

    const flagConfig = await configResp.json();

    // 3. Cache the fetched config in KV for future requests
    await flagsKV.put(kvKey, JSON.stringify(flagConfig), {
      expirationTtl: cacheTtlSeconds
    });

    // 4. Evaluate the flag
    return evaluateFlag(flagConfig, request, options);
  } catch (error) {
    // Error handling - fall back to default
    console.error(`Feature flag evaluation error for ${flagKey}:`, error);
    return defaultValue;
  }
}

/**
 * Evaluate a feature flag configuration against request context
 */
function evaluateFlag(
  flagConfig: any,
  request: Request,
  options: FeatureFlagOptions
): boolean {
  const { defaultValue = false, rolloutPercentage, targeting } = options;

  // If flag is explicitly disabled in config, return false
  if (flagConfig.enabled === false) {
    return false;
  }

  // If flag is explicitly enabled in config, check targeting/rollout
  if (flagConfig.enabled === true) {
    // Check targeting rules if specified
    if (targeting) {
      if (!checkTargeting(targeting, request)) {
        return false;
      }
    }

    // Check rollout percentage if specified
    if (rolloutPercentage !== undefined) {
      // Use a stable identifier for consistent hashing
      // In real implementation, you might use user ID, session ID, or IP
      const identifier =
        request.headers.get('X-User-ID') ||
        request.headers.get('CF-Connecting-IP') ||
        crypto.randomUUID(); // Fallback to random (not ideal for consistency)

      const hashValue = simpleHash(identifier, 100);
      return hashValue < rolloutPercentage;
    }

    // No targeting or rollout restrictions - flag is enabled
    return true;
  }

  // Fallback to default value
  return defaultValue;
}

/**
 * Check if request matches targeting criteria
 */
function checkTargeting(targeting: any, request: Request): boolean {
  // Country targeting
  if (targeting.countries && targeting.countries.length > 0) {
    const country = request.cf?.country;
    if (!country || !targeting.countries.includes(country)) {
      return false;
    }
  }

  // Device type targeting (reuse existing logic from main worker)
  if (targeting.deviceTypes && targeting.deviceTypes.length > 0) {
    const ua = request.headers.get('User-Agent') || '';
    const isMobile = /mobile|android/i.test(ua);

    const wantsMobile = targeting.deviceTypes.includes('mobile');
    const wantsDesktop = targeting.deviceTypes.includes('desktop');

    if (wantsMobile && !isMobile) return false;
    if (wantsDesktop && isMobile) return false;
  }

  // Add more targeting checks as needed

  return true;
}

/**
 * Simple boolean flag checker (wrapper for common use case)
 */
export async function isFeatureFlagSimple(
  flagsKV: KVNamespace,
  flagKey: string,
  request: Request,
  defaultValue: boolean = false
): Promise<boolean> {
  return isFeatureFlagEnabled(flagsKV, flagKey, request, { defaultValue });
}
