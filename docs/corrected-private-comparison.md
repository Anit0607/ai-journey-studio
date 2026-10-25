# Finite corrective comparison candidate (inactive)

This change does not grant a second paid attempt. The original scope remains
unchanged and its blocked six-stage run is preserved, not restarted or adopted.
The registry contains exactly that original scope and one separately bounded
corrective candidate; it is not a general retry or scope-registration mechanism.

The candidate pins predecessor `7d849360-6740-4cc6-bf14-63db7fb2d694`, its terminal
receipt, exact saved stage hashes, original state/configuration digests, and known
settled spending of 85,324 microdollars. Its maximum reservation is 764,676
microdollars, keeping both attempts together at or below 850,000. The existing
successor-only input bounds are 20k/20k/28k/30k/35k/65k, giving a six-stage
plan bound of 740,760 (826,084 combined with the predecessor). The original
18k/18k/24k/22k/30k/60k bounds remain unchanged. The monthly limit and existing safety buffer
remain enforced independently. Unknown usage, additional attempts, changed source,
permission, original output, configuration, or Calendar state fail closed.

Authorization is deliberately `pending`; the consent reference and final compiled
prompt-policy binding are not invented. A matching environment gate alone cannot
activate this candidate. After the final voice, grammar, Critic, diagnostic and
review changes are integrated, a canonical-LF prompt-policy manifest must be
independently generated and tested. Binding that factual digest while consent is
pending does not authorize execution. New owner permission must be separately
recorded and reviewed before any release gate is enabled or model call occurs.

The authenticated GET exposes a read-only admission preflight. This is a current
observation, not execution authority or a reservation. It performs no writes,
provider calls, or explicit FOR UPDATE locks. Existing scoped-source resolution
may acquire its normal read/shared locks. The server repeats the full family/state/budget
proof atomically under the existing shared budget guard before reservation and
each paid-stage admission. History and display are separated by explicit scope
and run; the old failed run remains inspectable and non-adoptable.

Offline tests include the captured predecessor output/usage proof and a historical
full-context fixture whose real JSON digest matches the recorded predecessor.
The runtime harness mocks authorization and the nonsecret configuration digest
only inside an isolated test module; production authorization stays pending.
Historical fixture success is not a claim that today's live rows still match.

Integration must also retain diagnostic terminal reasons and pass the newly
allocated revision token to `reviewReadiness` before adoption, once the assistant
review patch provides that API. This prevents old assistant clearance appearing
current for a same-byte new revision. No owner approval, scheduling or publication
is performed by comparison execution or model-output adoption.
