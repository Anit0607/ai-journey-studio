import {randomUUID} from "node:crypto";
import type {Store} from "../lib/store";
import type {Task,Source} from "../lib/domain";

/** Historical three-platform records deliberately have no versioned policy.
 * Only old-contract regression fixtures use this helper. Never called by app code. */
export async function enqueueLegacy(store:Store,source:string):Promise<Task>{
 const s=(await store.db.query<Source>("SELECT * FROM sources WHERE id=$1 AND cleared=true",[source]))[0];
 if(!s)throw Error("Legacy fixture source missing");
 const rows=await store.db.query<Task>("INSERT INTO tasks(id,source_id,source_hash,status) VALUES($1,$2,$3,'queued') ON CONFLICT(source_id,source_hash,origin_key) DO NOTHING RETURNING *",[randomUUID(),source,s.hash]);
 return rows[0]||(await store.db.query<Task>("SELECT * FROM tasks WHERE source_id=$1 AND source_hash=$2 AND origin_key='manual'",[source,s.hash]))[0];
}

export async function legacyCalendarFixture(store:Store){
 await store.db.query("UPDATE calendar_entries SET platform_schedule=jsonb_build_object('LinkedIn',platform_schedule->'LinkedIn','X',platform_schedule->'LinkedIn','Instagram',platform_schedule->'LinkedIn')");
}

/** Already-dispatched historical slot, seeded without invoking the new-work dispatcher. */
export async function seedLegacyCalendarDispatch(db:Store["db"],entryId:string,source:Source,at:Date){
 const entry=(await db.query<any>("SELECT * FROM calendar_entries WHERE id=$1",[entryId]))[0],id=randomUUID();
 const brief={kind:entry.kind,planned_date:entry.planned_date,platforms:["LinkedIn","X","Instagram"],intended_post:new Date(entry.intended_post).toISOString(),review_due:new Date(entry.review_due).toISOString(),generation_due:new Date(entry.generation_due).toISOString()};
 await db.query("INSERT INTO tasks(id,source_id,source_hash,status,origin_key,content_brief) VALUES($1,$2,$3,'queued',$4,$5)",[id,source.id,source.hash,"calendar:"+entryId,JSON.stringify(brief)]);
 await db.query("UPDATE calendar_entries SET task_id=$2 WHERE id=$1",[entryId,id]);
 await db.query("INSERT INTO calendar_jobs(id,entry_id,status,task_id,source_id,source_hash,dispatched_at) VALUES($1,$2,'dispatched',$3,$4,$5,$6)",[randomUUID(),entryId,id,source.id,source.hash,at]);
 return id;
}
