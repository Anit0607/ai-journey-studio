/** Read-only recovery after an unconfirmed activation/revocation response. Never retries a write. */
export async function recoverGithubPolicyStatus<T>(readStatus:()=>Promise<T>){
 try{return {status:await readStatus(),uncertain:false,notice:'The write response was not confirmed. Current saved status is shown; no write was retried.'};}
 catch{return {status:null,uncertain:true,notice:'The policy change has an unconfirmed outcome. Consent may be ON or OFF. Refresh the saved status before any further action; do not repeat the write.'};}
}
