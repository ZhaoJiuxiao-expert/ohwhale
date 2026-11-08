package cn.ohwhale.chat;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.os.Handler;
import android.os.Looper;
import java.util.concurrent.atomic.AtomicLong;

/** Persisted inexact background work, without a permanently running service. */
public final class ProactiveJobService extends JobService {
  private final AtomicLong generation=new AtomicLong();
  private ProactiveEngine engine;
  @Override public boolean onStartJob(JobParameters params){
    final long started=generation.incrementAndGet();
    try{engine=ProactiveEngine.get(this);engine.tick(true,result->{if(generation.get()==started)new Handler(Looper.getMainLooper()).post(()->{if(generation.get()==started)jobFinished(params,false);});});return true;}
    catch(Exception ignored){return false;}
  }
  @Override public boolean onStopJob(JobParameters params){generation.incrementAndGet();if(engine!=null)engine.cancelBackground();return true;}
}
