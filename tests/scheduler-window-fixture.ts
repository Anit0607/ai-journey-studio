import type {IntegrationSettings} from '../lib/integration-config';
import {FIXED_WEEKLY_UTC,OPTIONAL_DATED_UTC} from '../lib/scheduler-window-policy';
export const fixedSettings=(exception=true):IntegrationSettings=>({scheduler:{provider:'qstash',mode:'external',authorized:true,cadence_seconds:120,source_interval_minutes:60,window_policy:{kind:'fixed-cadence-v1',weekly_utc:[...FIXED_WEEKLY_UTC],exceptions_utc:exception?[OPTIONAL_DATED_UTC]:[]}}});
