/** Editorial constraints only. They grant neither source access nor factual approval. */
export const SOURCE_DRAFTING_CONTRACT_VERSION = '2026-10-24-attributed-commit-boundary';
/** Editorial classification only; it never grants source or transmission permission. */
export function attributedCommitSummary(source: string): string | null {
  const match = /^Attributed GitHub evidence; this record does not establish the owner’s experience\.\nRepository: [^\r\n]+\nAuthor account: [^\r\n]+\nCommitter account: [^\r\n]+\nCommit: [a-f0-9]{40}\n([^\r\n]+)$/.exec(source);
  return match?.[1] || null;
}
/** Remove the owner-learning goal itself, not merely contradict it later. */
export function sourceRoleGoal(checkpoint: number, source: string, ordinaryGoal: string): string {
  return checkpoint === 1 && /^Attributed (?:GitHub|YouTube) evidence;/.test(source)
    ? 'Choose one concise attributed source update, separating the recorded claim from unestablished outcomes. Do not infer a personal learning story.'
    : ordinaryGoal;
}
export function sourceDraftingContract(checkpoint: number, source: string): string {
  const attributed = /^Attributed (?:GitHub|YouTube) evidence;/.test(source);
  const common = ' Preserve who did what, the scope of a test, uncertainty, timing and negation. A request, observed result or verified removal does not identify the actor that performed it or prove a product capability. Never turn "I asked for deletion; removal was verified" into "Studio deleted it". Prior artifacts may contain mistakes; compare every claim to SOURCE, never inherit their endorsement.';
  const voice = attributed
    ? ' This is attributed external evidence: retain third-person repository/author or channel attribution. Never write its actions or feelings as the owner’s experience.'
    : ' This is an owner-written note. Writer and Platform Adapter preserve its first-person narrator where present; do not replace "I/my" with "the user" or write a product review for potential customers. Do not add a name, emotion, lesson, recommendation, capability or audience need not stated in the note.';
  const role = checkpoint === 0
    ? ' Extract complete verbatim source sentences with their provenance; prefer SOURCE: followed by the exact note.' + (attributed ? ' Preserve repository/account or channel attribution; never make the owner its narrator.' : ' Do not rewrite the facts into third person.')
    : checkpoint === 1
      ? ' Choose one angle without rewriting or expanding the facts. Keep any proposed angle separate from verbatim evidence; an observed event is not a learned lesson.'
      : checkpoint === 2
        ? ' Keep the brief short and limited to the active platform. Do not append optional video, carousel or other-platform plans. Distinguish a single observed test from a general reusable capability.'
        : checkpoint === 3 || checkpoint === 4
          ? (attributed ? ' Use concise source-attributed public prose, not the owner’s personal narration.' : ' Prefer the owner’s own supported words in short paragraphs.') + ' A concise milestone update needs no manufactured hook, advice, audience question or call to action. Do not add material merely to fill a format.'
          : checkpoint === 5
            ? ' Check action attribution and capability expansion explicitly, including earlier internal artifacts. A correctly formatted citation is not semantic proof. Flag unsupported public claims; never certify that the draft is factually verified.'
            : '';
  const commit = attributedCommitSummary(source)
    ? ' COMMIT-SUMMARY LIMIT: The supplied evidence is repository/account/commit metadata and one commit title, not code, a diff, tests or deployment results. Describe only what the repository records; quote the title exactly. A title does not establish that a feature works, enforces a boundary, improves security, expresses the author’s intent or represents a learned lesson. Do not expand exact-task or owner-only into unstated implementation details, role-based access or benefits. A thin source warrants a short attributed update, not a manufactured takeaway. Harvester preserves the complete SOURCE including its attribution disclaimer. Any Verbatim evidence section contains only exact copied source lines, never interpreted Scope, combined metadata or paraphrases. Keep missing evidence in internal artifacts, not public copy.'
    : '';
  return '\nSOURCE AND NARRATION CONTRACT (instructions, not additional evidence):' + common + voice + role + commit;
}
