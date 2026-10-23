import type {SourceIngestionConfig} from './source-ingestion';
export type IntegrationSettings = {
 sources?: SourceIngestionConfig;
 oauth?: import('./integration-oauth').OAuthConfig;
 scheduler?: { provider?:'qstash'|'external-bearer'; authorized?:boolean; mode?:'daily'|'external'; source_interval_minutes?:number; cadence_seconds?:number };
 publishing?: Record<string,unknown>;
 media?: import('./publication-media-storage').MediaStorageConfig;
};
/** Nonsecret server configuration only. Neither this JSON nor credentials are exposed to the browser. */
export function integrationConfig(env:Record<string,string|undefined>=process.env):IntegrationSettings {
 try { const value=JSON.parse(env.STUDIO_INTEGRATIONS_CONFIG||'{}'); return value&&typeof value==='object'&&!Array.isArray(value)?value:{}; } catch { return {}; }
}
export function schedulerStatus(config:IntegrationSettings){
 const s=config.scheduler;
 const mode=s?.mode==='daily'?'daily':s?.mode==='external'?'external':'unconfigured';
 const authorized=s?.authorized===true&&mode!=='unconfigured';
 const cadence=s?.cadence_seconds;
 return {mode,authorized,exact_time:false,publication_ready:authorized&&mode==='external'&&Number.isSafeInteger(cadence)&&cadence!>=15&&cadence!<=300,
 notice:mode==='daily'?'Daily delivery has an hour-wide window and cannot meet exact posting times. Scheduled publishing is blocked. Manual plans require the owner to return within their approved time window.':mode==='external'?'An independently provisioned authorized scheduler must invoke this endpoint. Saved configuration does not provision delivery.':'No integration scheduler is configured.'};
}
