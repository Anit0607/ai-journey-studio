import {hash} from './domain';
/** Trusted owner-message evidence, not a model prompt example or general fact grant.
 * New messages/tasks require an explicitly reviewed scope; no caller supplies facts. */
export const OWNER_MESSAGE_CONTEXT_POLICY='owner-message-context-v1';
export const OWNER_MESSAGE_CONTEXT_SCOPE=Object.freeze({
 project:'AI Journey Studio',
 task_id:'96737ed0-a683-4a3d-9b2e-89aea38a214e',
 source_id:'f68ae274-ae09-4987-9d61-b8704bb1bb91',
 source_hash:'b9207df4d35f15bd9a9d770891e482e9cdd000bdb9da5ef1439dc8b8d07ae603',
 message_reference:'Sentinel_b7c9856c988081919723843b0011c143',
 authorization_reference:'Sentinel_6759df00f0c8819198d3f79def3af5f2',
 message_quote:"Quick context: I'm building AI Journey Studio with AI agents, an app that turns what I'm learning about AI into LinkedIn drafts that only go out once I approve them.",
 statement_start:15,
 origin:'owner_self_report',imported_by:'assistant',
 purpose:'task-bound manual draft wording; no provider call, source transmission grant or publication approval'
});
export const OWNER_MESSAGE_CONTEXT_STATEMENT=OWNER_MESSAGE_CONTEXT_SCOPE.message_quote.slice(OWNER_MESSAGE_CONTEXT_SCOPE.statement_start);
export const OWNER_MESSAGE_CONTEXT_POLICY_HASH=hash(JSON.stringify({policy:OWNER_MESSAGE_CONTEXT_POLICY,...OWNER_MESSAGE_CONTEXT_SCOPE}));
