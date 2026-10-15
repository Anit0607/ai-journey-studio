import {QSTASH_SCHEDULER_SCHEMA} from "../lib/qstash-scheduler-schema";
import {OAUTH_SCHEMA} from "../lib/integration-oauth-schema";
import {MEDIA_SCHEMA} from "../lib/publication-media-schema";
import {MEDIA_UPLOAD_SCHEMA} from "../lib/media-upload-schema";
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SOURCE_INGESTION_SCHEMA} from '../lib/source-ingestion-schema';
import {PUBLISHING_SCHEMA} from '../lib/publishing-schema';
import {INTEGRATION_SCHEDULER_SCHEMA} from '../lib/integration-scheduler-schema';
test('all integration migration files exactly match embedded schema',async()=>{
 for(const [file,sql] of [['012_source_ingestion',SOURCE_INGESTION_SCHEMA],['013_publishing',PUBLISHING_SCHEMA],['014_integration_scheduler',INTEGRATION_SCHEDULER_SCHEMA],['015_publication_media',MEDIA_SCHEMA],['016_media_upload',MEDIA_UPLOAD_SCHEMA],['017_integration_oauth',OAUTH_SCHEMA],['018_qstash_scheduler',QSTASH_SCHEDULER_SCHEMA]])assert.equal((await readFile(new URL('../migrations/'+file+'.sql',import.meta.url),'utf8')).replace(/\r\n/g,'\n'),sql.replace(/\r\n/g,'\n'));
});
