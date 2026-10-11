import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import SourcePanel from "../app/source-panel";

test("source intake exposes a local file chooser but keeps the form empty and staging explicit",()=>{
  let calls=0;
  const html=renderToStaticMarkup(createElement(SourcePanel,{sources:[],proposedSource:"",sourceApproved:false,intakeAuthorized:false,liveEnabled:false,busy:false,action:async()=>{calls++;return true;}}));
  assert.match(html,/type="file"/);
  assert.match(html,/accept="\.txt,\.json,text\/plain,application\/json"/);
  assert.match(html,/Choosing it does not upload, stage, clear or send content to a model/);
  assert.match(html,/id="source-note"[^>]*><\/textarea>/);
  assert.match(html,/type="submit" disabled=""/);
  assert.match(html,/No sources saved/);
  assert.doesNotMatch(html,/Local file content preview/);
  assert.equal(calls,0);
});
