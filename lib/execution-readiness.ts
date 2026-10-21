/** Presentation only. Runtime permission is not proof that a worker is running. */
export function executionReadiness(input:{liveEnabled:boolean;hosted:boolean;generationEnabled:boolean}){
  const hostedPaused=input.hosted&&!input.generationEnabled;
  return {
    hostedPaused,
    badge:!input.liveEnabled?"Runtime checks blocked":hostedPaused?"Hosted drafting paused":"Runtime checks passed",
    title:!input.liveEnabled?"Secure setup is pending":hostedPaused?"Drafting is switched off":"Runtime checks passed; worker still required",
    notice:hostedPaused
      ?"Calendar drafting is OFF. Queued content will not run in hosted batches. Keep it off until you explicitly choose to enable drafting; enabling it can incur provider costs."
      :input.generationEnabled
        ?"Drafting opt-in is ON, but this does not prove a scheduler or worker is connected or running. Content still needs exact-source clearance and your review."
        :"Scheduled drafting is OFF. A separately authorized local worker may process manually queued work while it is running.",
  };
}
