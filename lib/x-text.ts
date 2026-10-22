import parseTweet from "twitter-text/dist/parseTweet.js";

// App safety bound, not an X limit. Bound upstream synchronous URL-regex work.
export const X_POST_MAX_INPUT_LENGTH=4096;

/** Server-side standard X post validation, not publication authorization.
 * The official parser applies NFC for counting, URL entities and emoji weights.
 * Never return normalized/truncated text: approvals bind the original bytes.
 * The pinned Twemoji override supplies current emoji data; see THIRD_PARTY_NOTICES.
 */
export function xPostTextValidation(text:string):{weightedLength:number|null;valid:boolean}{
  if(text.length>X_POST_MAX_INPUT_LENGTH)return {weightedLength:null,valid:false};
  const {weightedLength,valid}=parseTweet(text);
  return {weightedLength,valid};
}
