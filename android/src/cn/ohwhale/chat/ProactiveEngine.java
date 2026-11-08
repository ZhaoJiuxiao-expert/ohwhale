package cn.ohwhale.chat;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Native job engine. Only opaque credential references cross the JS boundary.
 * Immutable encrypted snapshots atomically contain the plan, retry ledger and inbox.
 * It never edits the foreground ChatStore, so a background job cannot overwrite a chat.
 */
final class ProactiveEngine {
  static final String FRIENDS_ORIGIN="https://47.86.23.218",CHANNEL="ohwhale-proactive-v1";
  static final String OPEN_ACTION="cn.ohwhale.chat.OPEN_PROACTIVE",EXTRA_CONVERSATION="conversationId";
  static final int JOB_ID=13217;
  private static final Object INSTANCE_LOCK=new Object();
  private static ProactiveEngine instance;
  private static volatile boolean foreground;
  private final Context context;
  private final ProactiveRecords records;
  private final SecretKey key;
  private final Object lock=new Object();
  private final AtomicBoolean busy=new AtomicBoolean(false);
  private final ExecutorService executor=Executors.newSingleThreadExecutor();
  private volatile Run current;
  private JSONObject state;
  private long backgroundGeneration;
  private String openedConversationId="";

  static ProactiveEngine get(Context context)throws Exception{synchronized(INSTANCE_LOCK){if(instance==null)instance=new ProactiveEngine(context.getApplicationContext());return instance;}}
  static void setForeground(boolean active){foreground=active;}
  private ProactiveEngine(Context app)throws Exception{
    context=app;
    KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);key=(SecretKey)ks.getKey("ohwhale-master-v1",null);if(key==null)throw new IOException("本机资料密钥暂不可用，请先打开一次哦鲸鲸。");
    records=new ProactiveRecords(new File(app.getFilesDir(),"encrypted-proactive"),key);
    String restored=records.latest(value->{JSONObject candidate=new JSONObject(value);return candidate.getInt("schema")==1&&candidate.optJSONObject("config")!=null&&candidate.optJSONArray("ledger")!=null&&candidate.optJSONArray("inbox")!=null;});
    if(restored!=null)state=new JSONObject(restored);
    else state=new JSONObject().put("schema",1).put("background",false).put("config",new JSONObject().put("enabled",false).put("quietHours",new JSONObject().put("enabled",true).put("start",23).put("end",8)).put("agents",new JSONArray())).put("syncedAt",0L).put("ledger",new JSONArray()).put("inbox",new JSONArray());
    channel();
  }
  private static byte[] read(InputStream source,int max)throws IOException{try(InputStream in=source;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>max)throw new IOException("Response exceeds limit");out.write(b,0,n);}return out.toByteArray();}}
  private static JSONObject copy(JSONObject value)throws Exception{return new JSONObject(value.toString());}
  private static void keys(JSONObject value,String...allowed)throws Exception{Set<String> set=new HashSet<>(Arrays.asList(allowed));for(Iterator<String> it=value.keys();it.hasNext();)if(!set.contains(it.next()))throw new Exception("主动问候设置含未支持的字段。");}
  private static String string(JSONObject value,String name,int max)throws Exception{Object raw=value.opt(name);if(!(raw instanceof String)||((String)raw).length()>max||((String)raw).indexOf('\0')>=0)throw new Exception("主动问候文字格式不完整。");return (String)raw;}
  private static boolean bool(JSONObject value,String name)throws Exception{Object raw=value.opt(name);if(!(raw instanceof Boolean))throw new Exception("主动问候开关格式不完整。");return (Boolean)raw;}
  private static long number(JSONObject value,String name,long max)throws Exception{Object raw=value.opt(name);if(!(raw instanceof Number))throw new Exception("主动问候时间格式不完整。");double d=((Number)raw).doubleValue();long n=((Number)raw).longValue();if(n<0||n>max||d!=n)throw new Exception("主动问候时间超出范围。");return n;}
  private static String id(JSONObject value,String name)throws Exception{String s=string(value,name,100);if(!s.matches("[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}"))throw new Exception("主动问候角色标识不完整。");return s;}
  private static String endpoint(String value)throws Exception{if(value.length()>2048||value.contains("?")||value.contains("#")||value.contains("\\"))throw new Exception("主动问候接口地址无效。");URI u=new URI(value);String host=u.getHost();boolean local=Arrays.asList("localhost","127.0.0.1","[::1]","::1").contains(host);if(host==null||u.getUserInfo()!=null||u.getRawAuthority().contains("@")||!("https".equals(u.getScheme())||"http".equals(u.getScheme())&&local)||!u.getPath().endsWith("/chat/completions")||!u.normalize().toString().equals(value))throw new Exception("主动问候仅支持可信聊天接口。");return value;}
  private JSONObject validateConfig(JSONObject input)throws Exception{
    keys(input,"enabled","quietHours","agents");bool(input,"enabled");JSONObject quiet=input.getJSONObject("quietHours");keys(quiet,"enabled","start","end");bool(quiet,"enabled");number(quiet,"start",23);number(quiet,"end",23);JSONArray agents=input.getJSONArray("agents");if(agents.length()>32)throw new Exception("主动问候一次最多安排32位伙伴。");Set<String> unique=new HashSet<>();
    for(int i=0;i<agents.length();i++){
      JSONObject a=agents.getJSONObject(i);keys(a,"agentId","name","conversationId","hour","mode","lastUserAt","lastChatAt","unansweredCount","lastGreetingAt","request");if(!unique.add(id(a,"agentId")))throw new Exception("主动问候角色不能重复。");id(a,"conversationId");string(a,"name",80);number(a,"hour",23);if(!Arrays.asList("daily","natural").contains(string(a,"mode",12)))throw new Exception("主动问候节奏无效。");for(String time:new String[]{"lastUserAt","lastChatAt","lastGreetingAt"})number(a,time,9007199254740991L);number(a,"unansweredCount",100000);
      JSONObject r=a.getJSONObject("request");keys(r,"kind","url","body","credentialRef");String kind=string(r,"kind",12),url=endpoint(string(r,"url",2048)),ref=string(r,"credentialRef",200);if(!Arrays.asList("managed","byok").contains(kind))throw new Exception("主动问候服务类型无效。");if(!ref.isEmpty()){byte[] bytes=Base64.decode(ref,Base64.NO_WRAP);if(!Base64.encodeToString(bytes,Base64.NO_WRAP).equals(ref)||!new String(bytes,StandardCharsets.US_ASCII).matches("[a-f0-9-]{36}"))throw new Exception("主动问候只接收本机加密凭据引用。");}
      if("managed".equals(kind)&&(!url.equals(FRIENDS_ORIGIN+"/v1/managed/chat/completions")||ref.isEmpty()))throw new Exception("托管问候只能使用内置服务与本机身份。");if("byok".equals(kind)&&ref.isEmpty()&&!url.startsWith("http://localhost")&&!url.startsWith("http://127.0.0.1")&&!url.startsWith("http://[::1]"))throw new Exception("请先保存这位角色的模型密钥。");
      String raw=string(r,"body",256*1024);if(raw.getBytes(StandardCharsets.UTF_8).length>256*1024)throw new Exception("主动问候上下文太长。");JSONObject body=new JSONObject(raw);keys(body,"model","messages","stream","max_tokens");if(string(body,"model",200).trim().isEmpty()||bool(body,"stream"))throw new Exception("主动问候请求需使用完整回复模式。");long tokens=number(body,"max_tokens",512);if(tokens<1)throw new Exception("主动问候回复长度无效。");JSONArray messages=body.getJSONArray("messages");if(messages.length()<1||messages.length()>24)throw new Exception("主动问候最多携带24条上下文。");for(int n=0;n<messages.length();n++){JSONObject m=messages.getJSONObject(n);keys(m,"role","content");if(!Arrays.asList("system","user","assistant").contains(string(m,"role",12)))throw new Exception("主动问候消息角色无效。");string(m,"content",64000);}
      credential(r); // Check endpoint-bound reference before accepting a future plan.
    }
    if(input.toString().getBytes(StandardCharsets.UTF_8).length>3*1024*1024)throw new Exception("主动问候计划太长，请减少启用的伙伴数量。");return copy(input);
  }
  JSONObject sync(JSONObject input)throws Exception{
    JSONObject config;
    try{config=validateConfig(input);}catch(Exception invalid){
      // A rejected newer configuration must not keep an older paid endpoint active.
      synchronized(lock){if(current!=null)current.cancel();JSONObject next=copy(state);next.getJSONObject("config").put("enabled",false);persist(next);schedule();}
      throw invalid;
    }
    synchronized(lock){long now=System.currentTimeMillis();if(!state.getJSONObject("config").toString().equals(config.toString())||now-state.getLong("syncedAt")>=ProactivePolicy.HOUR){JSONObject next=copy(state);next.put("config",config).put("syncedAt",now);persist(next);}Run run=current;if(run!=null&&!sameAgent(config,run.agent))run.cancel();schedule();return statusLocked();}
  }
  JSONObject enable(boolean enabled)throws Exception{synchronized(lock){if(enabled&&!notificationsAllowed())throw new Exception("先允许小鲸发送通知，后台问候才能开启哦。");JSONObject next=copy(state).put("background",enabled);persist(next);if(!enabled&&current!=null&&current.background)current.cancel();schedule();return statusLocked();}}
  JSONObject inbox()throws Exception{synchronized(lock){return new JSONObject().put("messages",new JSONArray(state.getJSONArray("inbox").toString()));}}
  JSONObject ack(JSONObject input)throws Exception{keys(input,"ids","openedConversationId");JSONArray ids=input.optJSONArray("ids");if(ids==null||ids.length()>1000)throw new Exception("主动问候确认列表不完整。");Set<String> accepted=new HashSet<>();for(int i=0;i<ids.length();i++){String s=ids.getString(i);if(!s.matches("[a-f0-9-]{36}"))throw new Exception("主动问候确认标识无效。");accepted.add(s);}synchronized(lock){JSONArray keep=new JSONArray(),old=state.getJSONArray("inbox");for(int i=0;i<old.length();i++){JSONObject m=old.getJSONObject(i);if(!accepted.contains(m.getString("id")))keep.put(m);}if(keep.length()!=old.length())persist(copy(state).put("inbox",keep));String opened=input.optString("openedConversationId","");if(!opened.isEmpty()&&opened.equals(openedConversationId))openedConversationId="";return statusLocked();}}
  void opened(String conversationId){if(conversationId!=null&&conversationId.matches("[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}"))synchronized(lock){openedConversationId=conversationId;}}
  JSONObject status()throws Exception{synchronized(lock){return statusLocked();}}
  private JSONObject statusLocked()throws Exception{
    JSONObject config=state.getJSONObject("config");JSONArray agents=config.getJSONArray("agents"),rows=new JSONArray();long now=System.currentTimeMillis();String today=ProactivePolicy.day(now);
    for(int i=0;i<agents.length();i++){JSONObject a=agents.getJSONObject(i),entry=ledger(a.getString("agentId"),today),row=new JSONObject().put("agentId",a.getString("agentId")).put("status",entry==null?reason(a,now):entry.optString("status","ready")).put("attempts",entry==null?0:entry.optInt("attempts")).put("nextRetryAt",entry==null?0:entry.optLong("nextRetryAt")).put("lastSuccessAt",lastSuccess(a.getString("agentId"))).put("lastError",entry==null?"":entry.optString("lastError",""));rows.put(row);}
    JobScheduler scheduler=(JobScheduler)context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
    return new JSONObject().put("backgroundEnabled",state.getBoolean("background")).put("notificationsEnabled",notificationsAllowed()).put("scheduled",scheduler.getPendingJob(JOB_ID)!=null).put("busy",busy.get()).put("pendingInbox",state.getJSONArray("inbox").length()).put("agents",rows).put("openedConversationId",openedConversationId);
  }
  boolean notificationsAllowed(){NotificationManager nm=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return false;NotificationChannel channel=nm.getNotificationChannel(CHANNEL);return nm.areNotificationsEnabled()&&(channel==null||channel.getImportance()!=NotificationManager.IMPORTANCE_NONE);}
  private void channel(){NotificationManager nm=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);NotificationChannel channel=new NotificationChannel(CHANNEL,"伙伴来打招呼",NotificationManager.IMPORTANCE_DEFAULT);channel.setDescription("你开启的角色主动问候；默认不展示私聊内容");channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);nm.createNotificationChannel(channel);}
  private void schedule()throws Exception{JobScheduler scheduler=(JobScheduler)context.getSystemService(Context.JOB_SCHEDULER_SERVICE);JSONObject config=state.getJSONObject("config");if(!state.getBoolean("background")||!config.getBoolean("enabled")||config.getJSONArray("agents").length()==0){scheduler.cancel(JOB_ID);return;}if(scheduler.getPendingJob(JOB_ID)!=null)return;JobInfo job=new JobInfo.Builder(JOB_ID,new ComponentName(context,ProactiveJobService.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).setPeriodic(15*ProactivePolicy.MINUTE).setBackoffCriteria(15*ProactivePolicy.MINUTE,JobInfo.BACKOFF_POLICY_EXPONENTIAL).build();if(scheduler.schedule(job)!=JobScheduler.RESULT_SUCCESS)throw new Exception("系统暂时没有接受后台问候任务，请稍后重新开启。");}
  interface Completion{void complete(JSONObject result);}
  void tick(boolean background,Completion completion){
    if(!busy.compareAndSet(false,true)){completion.complete(new JSONObject());return;}
    final long generation;synchronized(lock){generation=backgroundGeneration;}
    executor.execute(()->{JSONObject result=new JSONObject();try{runOne(background,generation);result=status();}catch(Exception ignored){}finally{current=null;busy.set(false);try{result=status();}catch(Exception ignored){}completion.complete(result);}});
  }
  void cancelBackground(){synchronized(lock){backgroundGeneration++;Run run=current;if(run!=null&&run.background)run.cancel();}}
  private String reason(JSONObject a,long now)throws Exception{
    JSONObject config=state.getJSONObject("config"),q=config.getJSONObject("quietHours");if(!config.getBoolean("enabled"))return "disabled";if(ProactivePolicy.quiet(now,q.getBoolean("enabled"),q.getInt("start"),q.getInt("end")))return "quiet-hours";
    int unanswered=a.getInt("unansweredCount"),count=0;long last=a.getLong("lastGreetingAt"),user=a.getLong("lastUserAt");JSONArray ledger=state.getJSONArray("ledger");for(int i=0;i<ledger.length();i++){JSONObject x=ledger.getJSONObject(i);if(x.getString("agentId").equals(a.getString("agentId"))&&x.optLong("successAt")>user){count++;last=Math.max(last,x.optLong("successAt"));}}
    return ProactivePolicy.reason(a.getString("agentId"),a.getInt("hour"),a.getString("mode"),now,state.getLong("syncedAt"),user,a.getLong("lastChatAt"),Math.max(count,unanswered),last);
  }
  private JSONObject ledger(String agentId,String day)throws Exception{JSONArray list=state.getJSONArray("ledger");for(int i=list.length()-1;i>=0;i--){JSONObject x=list.getJSONObject(i);if(agentId.equals(x.getString("agentId"))&&day.equals(x.getString("day")))return x;}return null;}
  private long lastSuccess(String agentId)throws Exception{long result=0;JSONArray list=state.getJSONArray("ledger");for(int i=0;i<list.length();i++){JSONObject x=list.getJSONObject(i);if(agentId.equals(x.getString("agentId")))result=Math.max(result,x.optLong("successAt"));}return result;}
  private static boolean sameAgent(JSONObject config,JSONObject selected)throws Exception{JSONArray list=config.getJSONArray("agents");if(!config.getBoolean("enabled"))return false;for(int i=0;i<list.length();i++){JSONObject a=list.getJSONObject(i);if(a.getString("agentId").equals(selected.getString("agentId")))return a.toString().equals(selected.toString());}return false;}
  private void replaceLedger(JSONObject next,JSONObject entry)throws Exception{JSONArray old=next.getJSONArray("ledger"),list=new JSONArray();for(int i=0;i<old.length();i++){JSONObject x=old.getJSONObject(i);if(!(x.getString("agentId").equals(entry.getString("agentId"))&&x.getString("day").equals(entry.getString("day"))))list.put(x);}list.put(entry);next.put("ledger",list);}
  private static String planHash(JSONObject agent)throws Exception{byte[] digest=MessageDigest.getInstance("SHA-256").digest(agent.toString().getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
  private static String iso(long time){SimpleDateFormat iso=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.ROOT);iso.setTimeZone(TimeZone.getTimeZone("UTC"));return iso.format(new Date(time));}
  /** Called only under lock. Prepared replies survive quiet hours without a second model call. */
  private void deliverPrepared(JSONObject agent,JSONObject entry,boolean background,long now)throws Exception{
    if(entry.optJSONObject("prepared")==null)return;
    String why=reason(agent,now);
    boolean unchanged=entry.getString("day").equals(ProactivePolicy.day(now))&&entry.optString("planHash").equals(planHash(agent));
    String decision=ProactivePolicy.delivery(unchanged,background,foreground,state.getBoolean("background"),notificationsAllowed(),why);
    if("wait".equals(decision))return;
    JSONObject next=copy(state),finished=copy(entry);JSONObject message=finished.getJSONObject("prepared");finished.remove("prepared");finished.remove("planHash");
    if("deliver".equals(decision)){
      if(state.getJSONArray("inbox").length()>=256)return;
      message.put("createdAt",iso(now));next.getJSONArray("inbox").put(message);
      finished.put("status","sent").put("successAt",now).put("text",message.getString("text")).put("nextRetryAt",0);
    }else finished.put("status","context-changed").put("suppressed",true).put("nextRetryAt",0).put("lastError","聊天节奏或设置变了，小鲸收好了这次问候，今天不再重复生成。");
    replaceLedger(next,finished);persist(next);
    if("deliver".equals(decision)&&background&&!foreground)notifyMessage(agent);
  }
  private void runOne(boolean background,long generation)throws Exception{
    JSONObject selected=null,entry=null;long now=System.currentTimeMillis();String day=ProactivePolicy.day(now);Run run;
    synchronized(lock){
      if(background&&(generation!=backgroundGeneration||!state.getBoolean("background")||foreground||!notificationsAllowed()))return;
      if(!background&&!foreground)return;
      // Inbox stays bounded; no generated messages are discarded for another API call.
      if(state.getJSONArray("inbox").length()>=256)return;
      JSONArray agents=state.getJSONObject("config").getJSONArray("agents");
      for(int i=0;i<agents.length();i++){JSONObject a=agents.getJSONObject(i),ready=ledger(a.getString("agentId"),day);if(ready!=null&&ready.optJSONObject("prepared")!=null){deliverPrepared(a,ready,background,now);return;}}
      int hourCalls=0,dayCalls=0;JSONArray all=state.getJSONArray("ledger");for(int i=0;i<all.length();i++){JSONObject x=all.getJSONObject(i);if(day.equals(x.getString("day")))dayCalls+=x.optInt("attempts");JSONArray times=x.optJSONArray("attemptTimes");if(times!=null)for(int n=0;n<times.length();n++)if(now-times.getLong(n)<ProactivePolicy.HOUR)hourCalls++;}if(hourCalls>=6||dayCalls>=24)return;
      for(int i=0;i<agents.length();i++){
        JSONObject a=agents.getJSONObject(i);if(!"due".equals(reason(a,now)))continue;JSONObject existing=ledger(a.getString("agentId"),day);
        if(existing!=null&&!ProactivePolicy.canAttempt(existing.optInt("attempts"),existing.optLong("successAt"),existing.optBoolean("suppressed"),existing.optLong("nextRetryAt"),now))continue;
        selected=copy(a);entry=existing==null?new JSONObject().put("agentId",a.getString("agentId")).put("day",day).put("attempts",0).put("attemptTimes",new JSONArray()):copy(existing);break;
      }
      if(selected==null)return;
      entry.put("attempts",entry.getInt("attempts")+1).put("status","pending").put("nextRetryAt",now+30*ProactivePolicy.MINUTE).put("lastError","");entry.getJSONArray("attemptTimes").put(now);
      JSONObject next=copy(state);replaceLedger(next,entry);persist(next);run=new Run(selected,background);current=run;
    }
    ScheduledExecutorService clock=Executors.newSingleThreadScheduledExecutor();ScheduledFuture<?> deadline=clock.schedule(run::cancel,75,TimeUnit.SECONDS);
    try{
      String reply=request(selected.getJSONObject("request"),selected,run);long completed=System.currentTimeMillis();
      synchronized(lock){
        if(run.cancelled.get()||!sameAgent(state.getJSONObject("config"),selected)||(background&&!state.getBoolean("background")))throw new IOException("cancelled");
        if(!day.equals(ProactivePolicy.day(completed)))throw new IOException("day changed");
        JSONObject finished=copy(entry);boolean duplicate=false;JSONArray history=state.getJSONArray("ledger");for(int i=history.length()-1;i>=0;i--){JSONObject prior=history.getJSONObject(i);if(selected.getString("agentId").equals(prior.getString("agentId"))&&prior.optLong("successAt")>completed-7*ProactivePolicy.DAY&&ProactivePolicy.duplicate(reply,prior.optString("text",""))){duplicate=true;break;}}
        JSONObject next=copy(state);if(duplicate)finished.put("status","similar-reply-skipped").put("suppressed",true).put("lastError","这次问候和最近太像，小鲸先不重复打扰啦。").put("nextRetryAt",0);
        else{
          String messageId=UUID.nameUUIDFromBytes((selected.getString("agentId")+"/"+day).getBytes(StandardCharsets.UTF_8)).toString();JSONObject body=new JSONObject(selected.getJSONObject("request").getString("body"));
          JSONObject message=new JSONObject().put("id",messageId).put("agentId",selected.getString("agentId")).put("conversationId",selected.getString("conversationId")).put("text",reply).put("model",body.getString("model")).put("createdAt",iso(completed)).put("day",day);
          finished.put("status","prepared").put("prepared",message).put("planHash",planHash(selected)).put("nextRetryAt",0);
        }
        replaceLedger(next,finished);persist(next);if(!duplicate)deliverPrepared(selected,finished,background,completed);
      }
    }catch(Exception e){synchronized(lock){JSONObject live=ledger(selected.getString("agentId"),day);if(live!=null&&live.optLong("successAt")==0&&!live.optBoolean("suppressed")&&live.optJSONObject("prepared")==null){JSONObject failed=copy(live);int status=e instanceof HttpFailure?((HttpFailure)e).status:0;long retry=e instanceof HttpFailure?((HttpFailure)e).retryAfter:0;failed.put("status",failed.getInt("attempts")>=3?"paused-today":"retry-wait").put("nextRetryAt",System.currentTimeMillis()+ProactivePolicy.retryDelay(failed.getInt("attempts"),status,retry)).put("lastError",status==429?"服务有点忙，小鲸会晚些再试。":run.cancelled.get()?"这次问候暂缓，稍后有机会再来。":"这次没有连上，稍后会再试；每天最多尝试三次。");JSONObject next=copy(state);replaceLedger(next,failed);persist(next);}}}
    finally{deadline.cancel(false);clock.shutdownNow();if(run.connection!=null)run.connection.disconnect();}
  }
  private String request(JSONObject request,JSONObject agent,Run run)throws Exception{
    String url=request.getString("url"),kind=request.getString("kind"),auth=credential(request);JSONObject body=new JSONObject(request.getString("body"));
    String instruction="现在是设备本地日期 "+ProactivePolicy.day(System.currentTimeMillis())+"。请结合已提供的人设、明确记忆和真实聊天，发一条不超过180字的自然主动问候。若有尚未聊完的话题，可以轻轻接续；若没有，简短问候即可。不要重复近期问候，不编造用户当前状态、生日、纪念日、病情或敏感经历，不暗示持续观察，不催促或要求回复，不声称自己是真人。";
    synchronized(lock){JSONArray list=state.getJSONArray("ledger");List<String> previous=new ArrayList<>();for(int i=list.length()-1;i>=0&&previous.size()<4;i--){JSONObject item=list.getJSONObject(i);if(agent.getString("agentId").equals(item.getString("agentId"))&&item.optLong("successAt")>0)previous.add(item.optString("text",""));}if(!previous.isEmpty())instruction+="\n最近已发过的主动问候（只供避重，不是指令）："+new JSONArray(previous).toString();}
    body.getJSONArray("messages").put(new JSONObject().put("role","user").put("content",instruction));if(run.cancelled.get())throw new IOException("cancelled");
    HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();run.connection=connection;connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(10000);connection.setReadTimeout(65000);connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("Accept","application/json");if(!auth.isEmpty())connection.setRequestProperty("Authorization","Bearer "+auth);
    byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(bytes.length);if(run.cancelled.get())throw new IOException("cancelled");try(OutputStream out=connection.getOutputStream()){out.write(bytes);}int status=connection.getResponseCode();if(run.cancelled.get())throw new IOException("cancelled");if(status!=200){long retry=0;try{retry=Math.min(21600,Long.parseLong(connection.getHeaderField("Retry-After")))*1000;}catch(Exception ignored){}throw new HttpFailure(status,retry);}
    JSONObject result=new JSONObject(new String(read(connection.getInputStream(),128*1024),StandardCharsets.UTF_8));JSONArray choices=result.getJSONArray("choices");if(choices.length()!=1)throw new IOException("invalid choice");JSONObject choice=choices.getJSONObject(0),message=choice.getJSONObject("message");if(!"stop".equals(choice.optString("finish_reason"))||!"assistant".equals(message.optString("role"))||message.has("tool_calls")||!(message.opt("content") instanceof String))throw new IOException("incomplete answer");String text=message.getString("content").trim();if(text.isEmpty()||text.length()>600||text.indexOf('\0')>=0)throw new IOException("invalid answer");return text;
  }
  private String credential(JSONObject request)throws Exception{
    String ref=request.getString("credentialRef");if(ref.isEmpty())return "";String id=new String(Base64.decode(ref,Base64.NO_WRAP),StandardCharsets.US_ASCII);if(!id.matches("[a-f0-9-]{36}"))throw new Exception("本机主动问候凭据无效。");boolean managed="managed".equals(request.getString("kind"));File file=new File(new File(context.getFilesDir(),"encrypted-secrets"),id+(managed?".friend.enc":".enc"));JSONObject record=new JSONObject(new String(unseal(read(new FileInputStream(file),22000),(managed?"friend-secret:":"secret:")+id),StandardCharsets.UTF_8));String url=request.getString("url");
    if(managed){if(!url.equals(FRIENDS_ORIGIN+"/v1/managed/chat/completions")||!FRIENDS_ORIGIN.equals(record.getString("origin"))||!"friends-v1".equals(record.getString("purpose")))throw new Exception("托管问候凭据不属于这个地址。");}
    else{String bound=record.getString("endpoint"),expected=bound.endsWith("/chat/completions")?bound:bound+"/chat/completions";if(!url.equals(expected))throw new Exception("模型地址已改变，请重新保存密钥。");}
    String value=record.getString("value");if(value.isEmpty()||value.length()>10000||value.matches("(?s).*[\\x00-\\x1f\\x7f].*"))throw new Exception("模型密钥格式不完整。");return value;
  }
  private void notifyMessage(JSONObject agent){try{if(!notificationsAllowed())return;Intent intent=new Intent(context,MainActivity.class).setAction(OPEN_ACTION).putExtra(EXTRA_CONVERSATION,agent.getString("conversationId")).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);int id=agent.getString("agentId").hashCode()&0x7fffffff;PendingIntent pending=PendingIntent.getActivity(context,id,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Notification notification=new Notification.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_email).setContentTitle(agent.getString("name")+"来打招呼啦").setContentText("有一条新的问候，点开慢慢聊吧。 ").setContentIntent(pending).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(Notification.CATEGORY_MESSAGE).build();((NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(id,notification);}catch(Exception ignored){}}
  private void persist(JSONObject next)throws Exception{long now=System.currentTimeMillis();JSONArray recent=new JSONArray(),history=next.getJSONArray("ledger");String oldest=ProactivePolicy.day(now-45*ProactivePolicy.DAY);for(int i=0;i<history.length();i++){JSONObject row=history.getJSONObject(i);if(row.getString("day").compareTo(oldest)>=0)recent.put(row);}next.put("ledger",recent);records.append(next.toString());state=next;}
  private byte[] unseal(byte[] data,String aad)throws Exception{return ProactiveRecords.open(data,aad,key);}
  private static final class Run{final JSONObject agent;final boolean background;final AtomicBoolean cancelled=new AtomicBoolean();volatile HttpURLConnection connection;Run(JSONObject a,boolean b){agent=a;background=b;}void cancel(){cancelled.set(true);if(connection!=null)connection.disconnect();}}
  private static final class HttpFailure extends IOException{final int status;final long retryAfter;HttpFailure(int status,long retry){this.status=status;retryAfter=retry;}}
}
