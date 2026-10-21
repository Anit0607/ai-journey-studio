import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSourceInput} from '../lib/sources';
const today=new Date('2026-10-21T12:00:00Z');
test('exclusion wording cannot bypass the conservative source privacy filter',()=>{
 assert.throws(()=>validateSourceInput({text:'Isolated reviewed project note. Exclude all bank, client and confidential material.',category:'project-note',reported_date:'2026-10-21'},today),/Excluded private material/);
});
test('a factual note without excluded keywords passes local intake validation',()=>{
 assert.doesNotThrow(()=>validateSourceInput({text:'Isolated reviewed project note. The workflow is still being tested, with final review retained by the owner.',category:'project-note',reported_date:'2026-10-21'},today));
});
