// Browser-safe privacy patterns shared by source intake and in-browser chat import.
export const EXCLUDED_MATERIAL=/\b(?:bandhan|banks?|banking|clients?|private|confidential|secrets?|credentials?|passwords?|passcodes?)\b|\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|session[ _-]?(?:cookie|token)|authorization)\s*(?:[:=]|\b)|\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{8,}/i;
export const CREDENTIAL_ASSIGNMENT=/(?:API[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|PASSWORD|SECRET|DATABASE_URL|PRIVATE[_-]?KEY)["']?\s*[:=]|[a-z][a-z0-9+.-]*:\/\/[^\/\s:@]+:[^\/\s@]+@/i;
/** True when text contains material the studio never stores or sends. */
export const privateMaterial=(text:string)=>EXCLUDED_MATERIAL.test(text)||CREDENTIAL_ASSIGNMENT.test(text);
