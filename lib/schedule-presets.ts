import {ALL_PLATFORMS,NEW_PLATFORMS} from "./platform-policy";
export const PLATFORMS=ALL_PLATFORMS;
export const ACTIVE_PLATFORMS=NEW_PLATFORMS;
export const BENCHMARK_PRESET={
  id:"india-first-buffer-hypothesis-v1",
  label:"India-first engagement benchmark — hypothesis, not proven viral",
  timezone:"Asia/Kolkata",
  times:{LinkedIn:{"1":"22:00","3":"16:00","5":"15:00","0":"22:00"},Instagram:{"1":"19:00","3":"12:00","5":"22:00","0":"21:00"},X:{"1":"09:00","3":"10:00","5":"09:00","0":"09:00"}},
  sources:[{platform:"LinkedIn",url:"https://buffer.com/resources/best-time-to-post-on-linkedin/",sample:"4.8M posts"},{platform:"Instagram",url:"https://buffer.com/resources/when-is-the-best-time-to-post-on-instagram/",sample:"9.6M posts"},{platform:"X",url:"https://buffer.com/resources/best-time-to-post-on-twitter-x/",sample:"Engagement benchmark"}],
  limitations:"Proposed first testing times, not an account-specific viral prediction. Dataset local times; not converted US hours. Other evidence disagrees, and Sunday LinkedIn/X evidence is weak. Validate with real audience metrics; no metrics are invented."
};
