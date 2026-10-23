# LinkedIn single-test release checkpoint — 23 October 2026

Status: bounded test window prepared. No publication result is established by this document.

## Authorized scope

- One text-only LinkedIn post to the owner's personal profile, not the company Page, using the existing approved connection.
- The exact content must remain bound to the explicitly approved manual publication plan. This is not permission for another post, edited content, scheduling, or autonomous provider work.
- No new credential, OAuth grant, access scope, account, or paid service is created by this release.

## Release and verification

1. Verify that the production configuration changes only the minimum gates needed for this single manual test. Keep automatic scheduling off and all unrelated provider, collection, generation and budget controls unchanged.
2. Deploy through the existing Git integration, with an exact-head review/check and guarded normal merge. Confirm the exact production commit and successful deployment before testing.
3. Verify the live manual-only controls and target account. Execute at most the approved single attempt. If the response is uncertain, use read-only status verification rather than sending again.
4. Record the actual outcome separately. A successful build is not proof that a post was published.

## Close the test window

Restore the temporary publishing gates to their prior disabled values immediately after the single test, or if the test is abandoned. Apply that configuration through another normal Git-integrated release and verify the live disabled state. Keep scheduling off throughout.

The follow-up checkpoint must distinguish configuration readback, deployment completion, live gate verification and the publication outcome. Do not treat a saved configuration alone as proof that the running deployment is disabled.
