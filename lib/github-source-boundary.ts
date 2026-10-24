import {createHash} from 'node:crypto';
import {assertSourcePrivacy} from "./sources";

export const SCOPED_GITHUB_REPOSITORY="anit0607/ai-journey-studio";
export const GITHUB_NOTE_MAX_PATHS=5;
export const GITHUB_NOTE_MAX_BYTES=8192;
export const GITHUB_NOTE_MAX_FETCHES=5;
export const GITHUB_NOTE_MAX_TREE_READS=3;
export const GITHUB_NOTES_SYNC_MAX_READS=12;
export const isGithubImmutableSha=(value:unknown):value is string=>typeof value==="string"&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);

/** All messages are fixed reason codes: never attach rejected source material. */
export class GithubSourceBoundaryError extends Error {
  constructor(readonly code:string){super(code);}
}
function fail(code:string):never{throw new GithubSourceBoundaryError(code);}

/** A small list of exact files, not directories, patterns, URLs, or traversal. */
export function normalizeGithubNotePaths(value:unknown):string[]{
  if(!Array.isArray(value)||!value.length||value.length>GITHUB_NOTE_MAX_PATHS)fail("github_note_paths_invalid");
  const paths=value.map(path=>{
    if(typeof path!=="string"||path.length>240||!/^docs\/build-notes\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(path)||path.includes(".."))fail("github_note_path_invalid");
    try{assertSourcePrivacy(path);}catch{fail("github_note_path_excluded");}
    return path;
  });
  return [...new Set(paths)].sort();
}

// Deliberately conservative. A note is data, never an instruction, and passing
// these guards is not proof that its factual assertions are true.
const UNSAFE=/\b(?:ignore|disregard|override|bypass|forget)\b.{0,100}\b(?:instructions?|prompts?|rules?|polic(?:y|ies)|safety|guards?|gates?|previous|above)\b|\b(?:system|developer|assistant)\s*(?:prompt|message|role|:)|\b(?:you (?:must|should|are now)|act as|follow (?:these|the following)|do not follow|jailbreak|exfiltrat\w*)\b|(?:^|[.!?:;,]\s+)(?:please\s+)?(?:run|execute|send|upload|publish|delete|reveal|output|respond|print|include|omit|pretend|claim|say|write|draft|generate|tell|treat|mark|approve|authorize|obey)\b/im;
const FACT=/^(?:(?:I|We)\s+(?:have\s+)?)?(?:added|built|checked|completed|created|documented|enabled|fixed|implemented|improved|integrated|introduced|migrated|passed|refactored|removed|replaced|resolved|shipped|tested|updated|validated|verified)\s+\S/i;

/** Reject directive-like text, code, control/format tricks, and excluded data. */
export function assertGithubEvidenceText(text:string):void{
  if(typeof text!=="string"||!text.trim()||/[\p{Cc}\p{Cf}]/u.test(text.replace(/[\r\n\t]/g,""))||/```|~~~|<\/?[A-Za-z!]|\bdata:|\bjavascript:/i.test(text)||UNSAFE.test(text))fail("github_source_unsafe_text");
  try{assertSourcePrivacy(text);}catch{fail("github_source_excluded_material");}
}

/**
 * Select only a factual, line-oriented progress section and immutable evidence.
 * The snapshot SHA is independent of linked evidence SHAs: a committed note
 * cannot know the hash of its own containing commit in advance. Links are never
 * followed. Returning the same canonical form makes downstream revalidation safe.
 */
export function validateGithubBuildNote(text:string,repository:string,commitSha:string):string{
  if(repository!==SCOPED_GITHUB_REPOSITORY||!isGithubImmutableSha(commitSha))fail("github_note_provenance_invalid");
  if(typeof text!=="string"||Buffer.byteLength(text,"utf8")>GITHUB_NOTE_MAX_BYTES)fail("github_note_too_large");
  assertGithubEvidenceText(text);
  const lines=text.replace(/\r\n/g,"\n").split("\n");
  const progress=lines.flatMap((line,index)=>line==="## Verified progress"?[index]:[]);
  const evidence=lines.flatMap((line,index)=>line==="## Evidence"?[index]:[]);
  if(progress.length!==1||evidence.length!==1||progress[0]>=evidence[0])fail("github_note_sections_invalid");
  const section=(start:number)=>{
    let end=start+1;while(end<lines.length&&!/^#{1,6}(?:\s|$)/.test(lines[end]))end++;
    return lines.slice(start+1,end).filter(line=>line.trim());
  };
  const facts=section(progress[0]).map(line=>{
    if(/^(?: {4}|\t)|[\[\]<>`]|https?:\/\//i.test(line))fail("github_note_progress_invalid");
    const fact=line.trim().replace(/^(?:[-*+] |\d+\. )/,"");
    if(!FACT.test(fact)||fact.length>1000)fail("github_note_progress_invalid");
    return fact;
  });
  if(!facts.length||facts.length>20)fail("github_note_progress_invalid");
  const links=section(evidence[0]).map(line=>{
    const value=line.trim().replace(/^(?:[-*+] |\d+\. )/,"");
    const markdown=/^\[[^\[\]\r\n]{1,100}\]\((https:\/\/[^\s()]+)\)$/.exec(value);
    const url=markdown?markdown[1]:value;
    const prefix=`https://github.com/${repository}/commit/`;
    if(!url.startsWith(prefix)||!isGithubImmutableSha(url.slice(prefix.length)))fail("github_note_evidence_invalid");
    return prefix+url.slice(prefix.length).toLowerCase();
  });
  if(!links.length||links.length>20)fail("github_note_evidence_invalid");
  return `## Verified progress\n${facts.map(fact=>"- "+fact).join("\n")}\n\n## Evidence\n${[...new Set(links)].map(link=>"- "+link).join("\n")}`;
}

/** One explicitly selected raw-text exception, never a source-clearance receipt. */
export const GITHUB_HASH_PINNED_TEXT_PATH='docs/build-notes/2026-10-24-linkedin-progress.md';
export const GITHUB_HASH_PINNED_TEXT_SHA256='d6819a05d82864b052fca17b19ad0a02b2aed0d7ef6ed73aaccd1ebce7b15a63';
export const GITHUB_HASH_PINNED_TEXT_PROFILE='hash-pinned-text-v1';
export type GithubNoteProfile={kind:'hash_pinned_text';path:string;sha256:string};
export type GithubNotesConfig={enabled?:boolean;paths:string[];commit_sha?:string;profile?:GithubNoteProfile};
export type GithubIntakeMode='commits_and_notes'|'notes_only';
export function githubNoteSettings(mode:unknown,notes:GithubNotesConfig|undefined){
  if(mode!==undefined&&mode!=='commits_and_notes'&&mode!=='notes_only')fail('github_notes_intake_mode_invalid');
  if(mode!=='notes_only'){
    if(notes?.commit_sha!==undefined||notes?.profile!==undefined)fail('github_notes_pin_requires_notes_only');
    return {mode:'commits_and_notes' as const,paths:notes?.enabled===true?normalizeGithubNotePaths(notes.paths):[],commitSha:undefined,profile:undefined};
  }
  if(notes?.enabled!==true)fail('github_notes_only_requires_enabled_notes');
  const paths=normalizeGithubNotePaths(notes.paths);
  if(!isGithubImmutableSha(notes.commit_sha))fail('github_notes_commit_pin_required');
  const profile=notes.profile;
  if(profile!==undefined){
    if(!profile||typeof profile!=='object'||Array.isArray(profile)||Object.keys(profile).sort().join(',')!=='kind,path,sha256'||profile.kind!=='hash_pinned_text'||profile.path!==GITHUB_HASH_PINNED_TEXT_PATH||profile.sha256!==GITHUB_HASH_PINNED_TEXT_SHA256||paths.length!==1||paths[0]!==profile.path)fail('github_notes_profile_invalid');
  }
  return {mode:'notes_only' as const,paths,commitSha:notes.commit_sha.toLowerCase(),profile};
}
/** Check exact raw bytes upstream; this only validates the unchanged decoded text. */
export function validateGithubHashPinnedText(text:string,repository:string,commitSha:string,path:string,rawSha256:string):string{
  if(repository!==SCOPED_GITHUB_REPOSITORY||!isGithubImmutableSha(commitSha)||path!==GITHUB_HASH_PINNED_TEXT_PATH||rawSha256!==GITHUB_HASH_PINNED_TEXT_SHA256)fail('github_note_profile_provenance_invalid');
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>GITHUB_NOTE_MAX_BYTES)fail('github_note_too_large');
  if(createHash('sha256').update(text,'utf8').digest('hex')!==rawSha256)fail('github_note_raw_hash_mismatch');
  assertGithubEvidenceText(text);
  return text;
}
