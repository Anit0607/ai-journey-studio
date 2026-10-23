/** Editorial constraints only. They grant neither source access nor factual approval. */
export const SOURCE_DRAFTING_CONTRACT_VERSION = '2026-10-23-actor-and-voice';
export function sourceDraftingContract(checkpoint: number, source: string): string {
  const attributed = /^Attributed (?:GitHub|YouTube) evidence;/.test(source);
  const common = ' Preserve who did what, the scope of a test, uncertainty, timing and negation. A request, observed result or verified removal does not identify the actor that performed it or prove a product capability. Never turn "I asked for deletion; removal was verified" into "Studio deleted it". Prior artifacts may contain mistakes; compare every claim to SOURCE, never inherit their endorsement.';
  const voice = attributed
    ? ' This is attributed external evidence: retain third-person repository/author or channel attribution. Never write its actions or feelings as the owner’s experience.'
    : ' This is an owner-written note. Writer and Platform Adapter preserve its first-person narrator where present; do not replace "I/my" with "the user" or write a product review for potential customers. Do not add a name, emotion, lesson, recommendation, capability or audience need not stated in the note.';
  const role = checkpoint === 0
    ? ' Extract complete verbatim source sentences with their provenance; prefer SOURCE: followed by the exact note. Do not rewrite the facts into third person.'
    : checkpoint === 1
      ? ' Choose one angle without rewriting or expanding the facts. Keep any proposed angle separate from verbatim evidence; an observed event is not a learned lesson.'
      : checkpoint === 2
        ? ' Keep the brief short and limited to the active platform. Do not append optional video, carousel or other-platform plans. Distinguish a single observed test from a general reusable capability.'
        : checkpoint === 3 || checkpoint === 4
          ? ' Prefer the owner’s own supported words in short paragraphs. A concise milestone update needs no manufactured hook, advice, audience question or call to action. Do not add material merely to fill a format.'
          : checkpoint === 5
            ? ' Check action attribution and capability expansion explicitly, including earlier internal artifacts. A correctly formatted citation is not semantic proof. Flag unsupported public claims; never certify that the draft is factually verified.'
            : '';
  return '\nSOURCE AND NARRATION CONTRACT (instructions, not additional evidence):' + common + voice + role;
}
