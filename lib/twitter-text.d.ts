/** Narrow declaration for the pinned official parser entry point we use. */
declare module "twitter-text/dist/parseTweet.js" {
  export default function parseTweet(text:string):{
    weightedLength:number;
    valid:boolean;
    permillage:number;
    validRangeStart:number;
    validRangeEnd:number;
    displayRangeStart:number;
    displayRangeEnd:number;
  };
}
