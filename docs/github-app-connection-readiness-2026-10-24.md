# GitHub App connection readiness checkpoint — 24 October 2026

## Bound connection
The owner provisioned a private GitHub App and installed it only on Anit0607/ai-journey-studio. The Production configuration binds App ID 5450669, installation ID 174694334, and selected repository ID 1412811582 to that one repository name.

The owner stored the App private key directly in Vercel as the Production-only Secret STUDIO_SOURCE_GITHUB_APP_PRIVATE_KEY. Only its presence, type and environment scope were checked. No private key or installation token is included in this repository or this checkpoint.

The nonsecret STUDIO_INTEGRATIONS_CONFIG change adds only sources.github.repositories and sources.github.app. All other fields, including the existing LinkedIn OAuth connection configuration, remain unchanged.

## Disabled operational gates
- GitHub source enabled and sync_authorized remain false.
- private_read_authorized remains unset, therefore not authorized.
- No source policy is activated and no note intake is enabled.
- Other source connections, drafting, publishing, scheduling and media operations remain off.
- This checkpoint makes no runtime/model, dependency, schema or application-code change.

## Deployment and acceptance
The existing normal Git integration deploys this documentation checkpoint so Production can load the separately saved connection settings. Preview deployments must not receive the Production private key.

After deployment, read-only application status should report the GitHub App as configured and authorized, with local readiness true, tested false, and no local-readiness error. GitHub source ingestion must still report disabled.

Local readiness checks configuration shape, the exact repository mapping and key presence only. It does not parse or test the private key, mint an installation token, call GitHub, import evidence, invoke a model or publish content. It must not be described as a verified live GitHub connection.

A later real authentication or source-intake check requires its own bounded authorized action. Do not enable source synchronization, private reads, source consent, drafting or a scheduler merely to turn a readiness indicator green.
