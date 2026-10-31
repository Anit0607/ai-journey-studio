// Browser-safe interview content; no server imports.
/** Interview questions adapted from linkedin-interviewer (sergebulaev/linkedin-skills, MIT,
 * commit 8f8bc4b); see THIRD_PARTY_NOTICES.md. Answers are the owner's own words. */
export const STORY_SETS={
  bank:{label:"Background stories",intro:"Broad questions about your AI journey. Answer the ones you can; skip the rest. Specifics (a date, a number, what went wrong) make the best posts.",questions:[
    {id:"building",q:"What are you building or learning with AI right now, and why does it matter to you?"},
    {id:"moment",q:"Which recent moment made you stop and think? When did it happen?"},
    {id:"belief",q:"What did you believe about AI, or about building with AI, a year ago that you no longer believe? What changed your mind?"},
    {id:"failure",q:"What went wrong recently? What did it cost you: time, money, a deadline?"},
    {id:"number",q:"Which number tells your story best? What exactly does it count, and over what period?"},
    {id:"position",q:"What do you think is true about learning AI that many people around you would disagree with?"},
    {id:"told",q:"Which story about your AI journey do you already tell friends or colleagues?"}
  ]},
  post:{label:"Prepare one post",intro:"A short interview about one topic. It ends with a story your agents can draft a single post from.",questions:[
    {id:"topic",q:"What is the topic, in one line?"},
    {id:"when",q:"When did this last actually happen? Give the date or month."},
    {id:"tried",q:"What did you try first, and what happened?"},
    {id:"wrong",q:"What did you get wrong, or what surprised you?"},
    {id:"advice",q:"What would you tell someone starting this today?"},
    {id:"reader",q:"Who is this for: Indian readers, or a global audience?"}
  ]}
} as const;
export type StorySet=keyof typeof STORY_SETS;
// Saved into the source text, so it must avoid words the privacy filter blocks (e.g. "bank").
export const STORY_MARKER="Owner story interview";
export const STORY_ANSWER_LIMIT=1500;

