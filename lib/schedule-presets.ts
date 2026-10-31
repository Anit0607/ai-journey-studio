import {ALL_PLATFORMS,NEW_PLATFORMS} from "./platform-policy";
export const PLATFORMS=ALL_PLATFORMS;
export const ACTIVE_PLATFORMS=NEW_PLATFORMS;
/** Evidence-based LinkedIn schedule (owner-approved 30 Oct 2026). Times are IST by weekday.
 * Studies are vendor research, not peer-reviewed; validate against the owner's own metrics. */
export const BENCHMARK_PRESET={
  id:"evidence-linkedin-v2-2026-10",
  label:"Evidence-based schedule: 2 India posts, 1 global post, 1 global long-form post",
  timezone:"Asia/Kolkata",
  times:{LinkedIn:{"1":"23:30","2":"09:00","3":"19:30","4":"09:00"},Instagram:{"1":"19:00","3":"12:00","5":"22:00","0":"21:00"},X:{"1":"09:00","3":"10:00","5":"09:00","0":"09:00"}},
  short_days:[1,2,4],
  long_day:3,
  slots:{"1":{audience:"global",format:"post",local:"Mon 1:00 pm US Eastern"},"2":{audience:"india",format:"post",local:"Tue 9:00 am IST"},"3":{audience:"global",format:"long-form post",local:"Wed 9:00 am US Eastern"},"4":{audience:"india",format:"post",local:"Thu 9:00 am IST"}} as Record<string,{audience:"india"|"global";format:string;local:string}>,
  sources:[
    {platform:"LinkedIn",url:"https://sproutsocial.com/insights/best-times-to-post-on-linkedin/",sample:"~2B engagements, 307k profiles; weekday late morning to afternoon, avoid weekends"},
    {platform:"LinkedIn",url:"https://buffer.com/resources/best-time-to-post-social-media/",sample:"~5M posts; Wednesday afternoon strongest"},
    {platform:"LinkedIn",url:"https://authoredup.com/blog/best-days-to-post-linkedin",sample:"3M+ posts; personal profiles 8-11 am local"},
    {platform:"LinkedIn",url:"https://magicpost.in/blog/best-time-to-post-on-linkedin-india",sample:"~220k India posts; weekday mornings around 8 am IST"}
  ],
  limitations:"Vendor studies, not peer-reviewed, partly overlapping. Global slots are fixed in UTC, so they fall an hour later in US Eastern summer time (10 am and 2 pm), still inside the studied windows. Validate with the owner's own post metrics."
};
/** Audience and format of the evidence schedule's slot for an IST date; empty for other days. */
export function slotBrief(planned:string):{audience?:"india"|"global";format?:string}{
  const slot=BENCHMARK_PRESET.slots[String(new Date(planned+"T00:00:00Z").getUTCDay())];
  return slot?{audience:slot.audience,format:slot.format}:{};
}
