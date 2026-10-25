/** Editorial constraints only. They grant neither source access nor factual approval. */
export const SOURCE_DRAFTING_CONTRACT_VERSION = '2026-10-25-practical-journey-brief';
/** Editorial classification only; it never grants source or transmission permission. */
export function attributedCommitSummary(source: string): string | null {
  const match = /^Attributed GitHub evidence; this record does not establish the owner’s experience\.\nRepository: [^\r\n]+\nAuthor account: [^\r\n]+\nCommitter account: [^\r\n]+\nCommit: [a-f0-9]{40}\n([^\r\n]+)$/.exec(source);
  return match?.[1] || null;
}
/** Editorial classification only, matching the bounded imported note envelope. */
export function attributedProgressNote(source:string):boolean{
  return /^Attributed GitHub evidence; this record does not establish the owner’s experience\.\nRepository: [^\r\n]+\nCommit: [a-f0-9]{40}\nNote: [^\r\n]+\.md\n\n## Verified progress\n/.test(source);
}
/** Remove the owner-learning goal itself, not merely contradict it later. */
export function sourceRoleGoal(checkpoint: number, source: string, ordinaryGoal: string): string {
  return checkpoint === 1 && /^Attributed (?:GitHub|YouTube) evidence;/.test(source)
    ? 'Choose one specific source-supported problem, decision or method and its observed limit/result for an attributed practical episode. If those details are missing, report an internal editorial hold rather than a generic status update. Do not infer a personal learning story.'
    : ordinaryGoal;
}
export function sourceDraftingContract(checkpoint: number, source: string): string {
  const attributed = /^Attributed (?:GitHub|YouTube) evidence;/.test(source);
  const common = ' Preserve who did what, the scope of a test, uncertainty, timing and negation. A gate based on configured work windows is not proof that it checks whether an actual queue job is due; retain the source’s stated condition instead of inventing a more capable check. A request, observed result or verified removal does not identify the actor that performed it or prove a product capability. Never turn "I asked for deletion; removal was verified" into "Studio deleted it". Prior artifacts may contain mistakes; compare every claim to SOURCE, never inherit their endorsement.';
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
    ? ' COMMIT-SUMMARY LIMIT: The supplied evidence is repository/account/commit metadata and one commit title, not code, a diff, tests or deployment results. Describe only what the repository records; quote the title exactly. A title does not establish that a feature works, enforces a boundary, improves security, expresses the author’s intent or represents a learned lesson. Do not expand exact-task or owner-only into unstated implementation details, role-based access or benefits. Do not reinterpret artifact privacy as privacy settings, ground attributed summaries as audit trails, or a fix: prefix as confirmation that an issue was resolved. These technical terms remain an exact quote, not evidence of implementation. SOURCE DATE is source-record metadata, not proof of when a commit was made, deployed or published; do not add it to public copy or insert it into a verbatim source. A title-only source can be retained as internal evidence, but it does not supply a practical learning episode: return an internal editorial hold instead of filling a calendar slot with a title recital or manufactured takeaway, even for a longform slot. Harvester returns only SOURCE: followed by the complete SOURCE including its attribution disclaimer. Any Verbatim evidence section contains only exact copied source lines, never interpreted Scope, combined metadata or paraphrases. Keep missing evidence in internal artifacts, not public copy. Critic treats inferred fix effects, dates absent from SOURCE, implementation details and benefits as unsupported with source_ids=[], not a wording-only paraphrase. Preserve its required JSON contract.'
    : '';
  const progress=attributedProgressNote(source)
    ? ' ATTRIBUTED PROGRESS-NOTE LIMIT: This is a repository-attributed progress note, not evidence of the owner’s personal story. Preserve the observer and actor explicitly stated in SOURCE; do not infer who observed or performed an action from the note envelope. Harvester returns only SOURCE: followed by the complete SOURCE, unchanged; no rewritten bullet list, invented date or extra summary. Story Miner selects a specific supported problem and decision/change/method with its observed result or limit, keeping complete source evidence verbatim internally. If the note cannot support that episode, return an internal editorial hold. Strategist connects the selected concrete detail to the reader’s practical use without adding facts: no manufactured hook, payoff, advice or generalized takeaway. Writer and Platform Adapter tell that supported episode naturally rather than reciting source sentences or the operations log, retaining attribution, actors, negation and the original historical subject. Do not turn a statement about an earlier record into a claim about the whole current note. Omit clock times unless necessary; otherwise copy them exactly. Do not round, truncate or reformat timestamps, because a by/before boundary may change. Do not add quality labels such as thorough, robust or smooth, or say tests prove correctness. Preserve the stated test scope: type checking, lint and builds are separate checks, not included in the numbered test count unless SOURCE explicitly establishes otherwise. Keep limitations and advice internal unless the selected source sentence itself is the supported point. Reporting that an earlier draft made unsupported claims is not asserting those claims; Critic must compare the complete current assertion, not flag a negated historical claim as an endorsed capability. Exact excerpts still need human content review, and paraphrases still need the existing evidence review. Preserve the required Critic JSON and verdict/source-ID contract.'
    : '';
  return '\nSOURCE AND NARRATION CONTRACT (instructions, not additional evidence):' + common + voice + role + commit + progress;
}
