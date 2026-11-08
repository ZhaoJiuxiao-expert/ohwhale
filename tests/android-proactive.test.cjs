'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');

test('Android native scheduling policy executes real Java time, cooldown, retry and duplicate vectors',t=>{
 const javac=cp.spawnSync('javac',['-version'],{encoding:'utf8'});
 if(javac.error){t.skip('A JDK is required for native Java policy execution');return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ohwhale-proactive-java-'));
 const file=path.join(dir,'ProactivePolicyCheck.java');
 const java=`package cn.ohwhale.chat;
import java.util.*;
public final class ProactivePolicyCheck {
 static void check(boolean condition,String name){if(!condition)throw new AssertionError(name);}
 static long at(int day,int hour,int minute){Calendar c=Calendar.getInstance();c.set(2026,Calendar.NOVEMBER,day,hour,minute,0);c.set(Calendar.MILLISECOND,0);return c.getTimeInMillis();}
 static String reason(long now,long lastUser,long lastChat,int unanswered,long lastGreeting,String mode){return ProactivePolicy.reason("deepseek",9,mode,now,now-1000,lastUser,lastChat,unanswered,lastGreeting);}
 public static void main(String[]args){
  TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));long now=at(8,10,0),hour=ProactivePolicy.HOUR;
  check(ProactivePolicy.day(now).equals("2026-11-08"),"local calendar day");
  check(ProactivePolicy.quiet(at(8,23,0),true,23,8),"overnight start inclusive");
  check(ProactivePolicy.quiet(at(8,7,59),true,23,8),"overnight before end");
  check(!ProactivePolicy.quiet(at(8,8,0),true,23,8),"quiet end exclusive");
  check(ProactivePolicy.quiet(now,true,8,8),"all-day quiet");
  check(!ProactivePolicy.quiet(now,false,8,8),"disabled quiet");
  check(ProactivePolicy.quiet(now,true,9,12),"same-day quiet");
  check(reason(at(8,8,59),0,0,0,0,"daily").equals("not-due"),"before requested hour");
  check(reason(at(8,13,0),0,0,0,0,"daily").equals("due"),"same-day missed-hour catchup");
  check(reason(at(9,8,0),0,0,0,0,"daily").equals("not-due"),"do not catch up yesterday");
  check(reason(now,now-hour,now-hour,0,0,"daily").equals("recent-chat"),"recent actual conversation suppresses");
  check(reason(now,now-2*hour,now-2*hour,0,0,"daily").equals("due"),"cooldown expired");
  check(reason(now,0,0,2,now-24*hour,"daily").equals("giving-space"),"fixed schedules respect unanswered contact");
  check(reason(now,0,0,2,now-24*hour,"natural").equals("giving-space"),"natural unanswered cooldown");
  check(reason(now,0,0,2,now-49*hour,"natural").equals("due"),"48h cooldown expires");
  check(reason(now,0,0,0,at(8,9,0),"daily").equals("sent"),"legacy foreground success blocks duplicate after upgrade");
  check(reason(now,now-8*ProactivePolicy.DAY,0,0,0,"natural").equals("waiting-for-you"),"natural contact pauses after a week without user contact");
  check(reason(now,0,0,0,0,"natural").equals("due"),"first-ever contact allowed");
  check(ProactivePolicy.reason("a",9,"daily",now,now-8*ProactivePolicy.DAY,0,0,0,0).equals("stale-plan"),"stale contexts cannot run indefinitely");
  int jitter=ProactivePolicy.jitter("deepseek","2026-11-08");check(jitter>=0&&jitter<=60,"jitter range");check(jitter==ProactivePolicy.jitter("deepseek","2026-11-08"),"stable day jitter");
  check(ProactivePolicy.dueAt("deepseek",9,"natural",now)==at(8,9,0)+jitter*ProactivePolicy.MINUTE,"natural due time");
  check(!ProactivePolicy.canAttempt(3,0,false,0,now),"three attempts exhausted");check(!ProactivePolicy.canAttempt(1,now,false,0,now),"success cannot retry");check(!ProactivePolicy.canAttempt(1,0,true,0,now),"duplicate-suppressed day cannot retry");check(!ProactivePolicy.canAttempt(1,0,false,now+hour,now),"persisted crash lease honored");check(ProactivePolicy.canAttempt(1,0,false,now-1,now),"failed attempt can retry when due");
  check(ProactivePolicy.retryDelay(1,500,0)==15*ProactivePolicy.MINUTE,"first retry");check(ProactivePolicy.retryDelay(2,500,0)==30*ProactivePolicy.MINUTE,"second retry");check(ProactivePolicy.retryDelay(3,500,0)==60*ProactivePolicy.MINUTE,"bounded third delay");check(ProactivePolicy.retryDelay(1,429,0)==30*ProactivePolicy.MINUTE,"429 minimum delay");check(ProactivePolicy.retryDelay(1,503,2*hour)==2*hour,"retry-after honored");
  check(ProactivePolicy.duplicate("小鲸来啦，今天过得怎么样？","小鲸来啦！今天过得怎么样"),"punctuation normalization");check(!ProactivePolicy.duplicate("昨天那道题后来想明白了吗","来分享一下今天最开心的小事吧"),"different topics preserved");
  check(ProactivePolicy.delivery(true,true,false,true,true,"quiet-hours").equals("wait"),"quiet starts while model is running: retain paid answer");
  check(ProactivePolicy.delivery(true,true,false,true,true,"due").equals("deliver"),"quiet ends same day: deliver without generating again");
  check(ProactivePolicy.delivery(false,true,false,true,true,"due").equals("discard"),"crossed midnight or changed context: discard stale prepared reply");
  check(ProactivePolicy.delivery(true,true,false,false,true,"due").equals("wait"),"background consent revoked before delivery");
  check(ProactivePolicy.delivery(true,true,false,true,false,"due").equals("wait"),"notification permission revoked before delivery");
  check(ProactivePolicy.delivery(true,false,false,false,true,"due").equals("wait"),"foreground request cannot silently turn into background delivery");
  check(ProactivePolicy.delivery(true,false,true,false,true,"disabled").equals("discard"),"disabled plan cannot deliver");
  System.out.println("Native policy vectors passed; jitter="+jitter);
 }
}`;
 fs.writeFileSync(file,java,{flag:'wx'});
 const compile=cp.spawnSync('javac',['-encoding','UTF-8','--release','8','-d',dir,path.join(root,'android/src/cn/ohwhale/chat/ProactivePolicy.java'),file],{encoding:'utf8'});assert.equal(compile.status,0,compile.stderr);
 const run=cp.spawnSync('java',['-cp',dir,'cn.ohwhale.chat.ProactivePolicyCheck'],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/Native policy vectors passed/);
 const crypto=require('node:crypto'),jitter=parseInt(crypto.createHash('sha256').update('deepseek:2026-11-08').digest('hex').slice(0,8),16)%61;assert.match(run.stdout,new RegExp('jitter='+jitter+'\\b'));
});

test('Native encrypted records recover torn writes and bind durable inbox with attempt ledger',t=>{
 if(cp.spawnSync('javac',['-version'],{encoding:'utf8'}).error){t.skip('A JDK is required for native storage execution');return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ohwhale-proactive-records-')),file=path.join(dir,'ProactiveRecordsCheck.java');
 const java=`package cn.ohwhale.chat;
import java.io.*;import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.util.*;import javax.crypto.*;
public final class ProactiveRecordsCheck {
 static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);}
 public static void main(String[]args)throws Exception {
  File root=new File(args[0]);KeyGenerator generator=KeyGenerator.getInstance("AES");generator.init(256);SecretKey key=generator.generateKey();
  ProactiveRecords records=new ProactiveRecords(new File(root,"good"),key);check(records.latest(s->true)==null,"empty state");
  String claim="attempt=1;success=0;inbox=[]",success="attempt=1;success=1;inbox=[stable-id-private-message]";
  File first=records.append(claim);byte[] original=Files.readAllBytes(first.toPath());File second=records.append(success);
  check(!Arrays.equals(original,Files.readAllBytes(second.toPath())),"fresh authenticated snapshot");
  check(!new String(Files.readAllBytes(second.toPath()),StandardCharsets.ISO_8859_1).contains("private-message"),"no plaintext chat content on disk");
  check(new ProactiveRecords(new File(root,"good"),key).latest(s->s.startsWith("attempt=")).equals(success),"success ledger and inbox recover as one committed unit");
  File torn=new File(second.getParentFile(),"9999999999999999-00000000-0000-0000-0000-000000000000.enc");Files.write(torn.toPath(),new byte[]{'O','W','E','1',12,1});
  check(new ProactiveRecords(new File(root,"good"),key).latest(s->true).equals(success),"partial newer write falls back to last authenticated snapshot");
  check(Arrays.equals(original,Files.readAllBytes(first.toPath())),"previous snapshots never rewritten");
  ProactiveRecords invalid=new ProactiveRecords(new File(root,"invalid"),key);Files.copy(second.toPath(),new File(root,"invalid/0000000000000001-00000000-0000-0000-0000-000000000000.enc").toPath());
  boolean rejected=false;try{invalid.latest(s->true);}catch(IOException expected){rejected=true;}check(rejected,"renamed snapshot fails AAD and does not silently reset ledger");
  ProactiveRecords wrongKey=new ProactiveRecords(new File(root,"good"),generator.generateKey());rejected=false;try{wrongKey.latest(s->true);}catch(IOException expected){rejected=true;}check(rejected,"wrong key fails closed");
  ProactiveRecords schema=new ProactiveRecords(new File(root,"schema"),key);schema.append(claim);schema.append("bad schema");check(new ProactiveRecords(new File(root,"schema"),key).latest(s->s.startsWith("attempt=")).equals(claim),"invalid newer payload does not erase previous ledger");
  System.out.println("Native encrypted persistence vectors passed");
 }
}`;
 fs.writeFileSync(file,java,{flag:'wx'});
 const compile=cp.spawnSync('javac',['-encoding','UTF-8','--release','8','-d',dir,path.join(root,'android/src/cn/ohwhale/chat/ProactiveRecords.java'),file],{encoding:'utf8'});assert.equal(compile.status,0,compile.stderr);
 const run=cp.spawnSync('java',['-cp',dir,'cn.ohwhale.chat.ProactiveRecordsCheck',dir],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/Native encrypted persistence vectors passed/);
});
