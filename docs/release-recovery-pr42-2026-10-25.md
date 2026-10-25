# PR42 production recovery checkpoint

The first production deployment of commit `07c87a3c94487d0ff4758e90e25e793c3033008a` failed on 25 October 2026 during migration 020 connection setup. The supplied sanitized build error identifies the connection stage before BEGIN or migration SQL; migrations 021/022 and Next build were not reached. It does not identify the underlying transport cause.

Failed deployment: `dpl_EWEpuSJLgKLE57y6h9hT8o8FE11H` ([inspection](https://vercel.com/anit1/ai-journey-studio/EWEpuSJLgKLE57y6h9hT8o8FE11H)).

The canonical application remained on the previous successful PR41 deployment. Fresh authenticated application reads at 08:36–08:37 UTC succeeded against PostgreSQL, preserved the source, Calendar and publication state, and showed no active task leases or unresolved model accounting. Source-policy availability and the existing outbox fields provide limited schema-backed evidence, not complete catalog validation or proof of build-runner connectivity. Neon reported the production compute ACTIVE at 08:37 UTC; compute state alone is not schema proof.

This documentation-only checkpoint requests one controlled normal Git-integrated production retry. All reviewed application, test, configuration and dependency bytes from tree `44a3a98a0ac550c6327eeceed8299df3d39d10b6` remain unchanged. The strict production migration 020/021/022 checks remain mandatory. No connection timeout, TLS, credential, permission, source, timer, budget or publication setting is changed. This checkpoint does not run drafting or approve a post.

Preserve the failed deployment and stop for diagnosis if the controlled retry fails. Successful deployment must be verified separately; this document is not a success receipt.
