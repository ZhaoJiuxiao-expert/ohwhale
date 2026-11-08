package cn.ohwhale.chat;

import java.text.Normalizer;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;

/** Deterministic scheduling rules; no Android APIs, network or user storage. */
final class ProactivePolicy {
  static final long MINUTE=60000L,HOUR=60*MINUTE,DAY=24*HOUR;
  static String day(long now){Calendar c=Calendar.getInstance();c.setTimeInMillis(now);return String.format(Locale.ROOT,"%04d-%02d-%02d",c.get(Calendar.YEAR),c.get(Calendar.MONTH)+1,c.get(Calendar.DAY_OF_MONTH));}
  static boolean quiet(long now,boolean enabled,int start,int end){if(!enabled)return false;Calendar c=Calendar.getInstance();c.setTimeInMillis(now);int hour=c.get(Calendar.HOUR_OF_DAY);return start==end||(start<end?hour>=start&&hour<end:hour>=start||hour<end);}
  static int jitter(String agentId,String day){try{byte[] hash=MessageDigest.getInstance("SHA-256").digest((agentId+":"+day).getBytes(StandardCharsets.UTF_8));long prefix=((hash[0]&255L)<<24)|((hash[1]&255L)<<16)|((hash[2]&255L)<<8)|(hash[3]&255L);return (int)(prefix%61);}catch(Exception e){throw new IllegalStateException(e);}}
  static long dueAt(String agentId,int hour,String mode,long now){Calendar c=Calendar.getInstance();c.setTimeInMillis(now);c.set(Calendar.HOUR_OF_DAY,hour);c.set(Calendar.MINUTE,0);c.set(Calendar.SECOND,0);c.set(Calendar.MILLISECOND,0);if("natural".equals(mode))c.add(Calendar.MINUTE,jitter(agentId,day(now)));return c.getTimeInMillis();}
  static String reason(String agentId,int hour,String mode,long now,long syncedAt,long lastUserAt,long lastChatAt,int unanswered,long lastGreetingAt){
    if(syncedAt<=0||now-syncedAt>7*DAY)return "stale-plan";
    if(lastGreetingAt>0&&day(lastGreetingAt).equals(day(now)))return "sent";
    if(now<dueAt(agentId,hour,mode,now))return "not-due";
    if(lastChatAt>0&&now-lastChatAt<90*MINUTE)return "recent-chat";
    if(unanswered>=2&&lastGreetingAt>0&&now-lastGreetingAt<2*DAY)return "giving-space";
    if("natural".equals(mode)&&lastUserAt>0&&now-lastUserAt>7*DAY)return "waiting-for-you";
    return "due";
  }
  static boolean canAttempt(int attempts,long successAt,boolean suppressed,long nextRetryAt,long now){return successAt<=0&&!suppressed&&attempts<3&&now>=nextRetryAt;}
  static String delivery(boolean unchanged,boolean background,boolean foreground,boolean backgroundEnabled,boolean notificationsAllowed,String reason){
    if(!unchanged||"disabled".equals(reason)||"stale-plan".equals(reason)||"sent".equals(reason))return "discard";
    if(background&&(!backgroundEnabled||!notificationsAllowed)||!background&&!foreground||"quiet-hours".equals(reason))return "wait";
    return "due".equals(reason)?"deliver":"discard";
  }
  static long retryDelay(int attempts,int httpStatus,long retryAfter){long delay=Math.min(60L,15L*(1L<<Math.min(2,Math.max(0,attempts-1))))*MINUTE;if(httpStatus==429)delay=Math.max(delay,30*MINUTE);return Math.max(delay,Math.min(6*HOUR,Math.max(0,retryAfter)));}
  static String normalized(String text){StringBuilder out=new StringBuilder();String s=Normalizer.normalize(text,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);for(int i=0;i<s.length();){int cp=s.codePointAt(i);if(Character.isLetterOrDigit(cp))out.appendCodePoint(cp);i+=Character.charCount(cp);}return out.toString();}
  static Set<String> grams(String s){Set<String> set=new HashSet<>();for(int i=0;i+1<s.length();i++)set.add(s.substring(i,i+2));return set;}
  static boolean duplicate(String first,String second){String a=normalized(first),b=normalized(second);if(a.isEmpty()||b.isEmpty())return false;if(a.equals(b))return true;if(a.length()<8||b.length()<8)return false;Set<String>x=grams(a),y=grams(b);int common=0;for(String part:x)if(y.contains(part))common++;return 2.0*common/(x.size()+y.size())>=0.88;}
}
