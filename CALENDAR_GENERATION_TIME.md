# Bring one unbound planned draft forward

An authenticated owner can choose “Make this draft due now” on one eligible
LinkedIn-only Calendar entry. This is a generation-time change, not final-post
approval, personal source review, a source grant or a model call.

The preview binds the exact entry and settings (including database microsecond
precision), active policy receipt and runtime, and current eligible provenance
identities to the literal `server_now` mode. The write uses the real server clock
at its final write boundary. Caller dates, fake clocks and backdating to a missed
target are not accepted. Posting time, platform schedule, draft/review times and
recurring settings stay unchanged; the existing 120–336-hour lead and review
cushion must still hold. A final recheck rolls back if guards change during writes.

Settings and the exact entry are locked in the established order. Current links,
any retained job/origin-task/grant, identifiable publication or recovery receipts,
and prior timing receipts block a new change. The four specifically normalized
historical plans are excluded. History reads and parsing are bounded and strict,
including scalar UUID/hash fields and duplicate JSON keys. Older generic
source-only link/unlink events did not record an entry ID, so the application
cannot prove an entry was never linked in its entire history. Such events confer
no source or execution authority. This action does not rewrite that history.

A repeated identical request returns its validated original historical receipt,
not a fresh change or assertion that the entry is still in that state. A new
preview cannot reset the same entry. Source evidence is not reserved by preview
or retiming: the existing due-dispatch transaction selects unused evidence under
the currently active policy, records the existing scoped grant, and the existing
exact-Calendar runner rechecks source/runtime/budget/lease/timing guards. Policy
sources remain “policy-authorized, not individually reviewed.” No owner-clearance
fields are written. All factual/editorial holds and final owner publication
approval remain required.

The UI is deliberately unchecked and version-bound, prevents duplicate clicks,
and keeps an attempted request locked after an uncertain response. Inspect the
saved generation time before continuing. There is no migration, credential,
provider/model, cap, scheduler, publishing or source-scope change.
