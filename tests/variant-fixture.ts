/** Isolated tests only. No persisted user workspace records are seeded. */
export const variantFixture=(text="Proposed approach: inspect one cleared source.")=>["LinkedIn","X","Instagram"].map(platform=>"### "+platform+"\n"+text).join("\n\n");
