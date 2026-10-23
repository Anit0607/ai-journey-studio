import {hash} from "./domain";
import {taskPlatformPolicy} from "./platform-policy";
/** Exact scope token for owner action-time intent; never used as publication consent. */
export const taskPlatformPolicyHash=(task:{content_brief?:Record<string,unknown>})=>hash(JSON.stringify({schema:1,platform_policy:taskPlatformPolicy(task)||null}));
