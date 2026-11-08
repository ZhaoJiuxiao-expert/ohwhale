package cn.ohwhale.chat;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Immutable authenticated snapshots. A torn newest write never hides the last valid one. */
final class ProactiveRecords {
  interface Validator { boolean valid(String value)throws Exception; }
  private final File folder;
  private final SecretKey key;
  private long stamp;
  ProactiveRecords(File folder,SecretKey key)throws IOException {
    this.folder=folder;this.key=key;
    if(!folder.isDirectory()&&!folder.mkdirs())throw new IOException("Cannot create private proactive records");
  }
  String latest(Validator validator)throws Exception {
    File[] files=folder.listFiles((dir,name)->name.matches("[0-9]{16}-[a-f0-9-]+\\.enc"));
    if(files==null)throw new IOException("Cannot read private proactive records");
    Arrays.sort(files,Comparator.comparing(File::getName).reversed());
    for(File file:files) {
      stamp=Math.max(stamp,Long.parseLong(file.getName().substring(0,16)));
      try {
        String value=new String(open(read(file),"proactive:"+file.getName(),key),StandardCharsets.UTF_8);
        if(validator.valid(value))return value;
      }catch(Exception ignored){}
    }
    if(files.length>0)throw new IOException("No authenticated proactive snapshot is available");
    return null;
  }
  File append(String value)throws Exception {
    byte[] data=value.getBytes(StandardCharsets.UTF_8);
    if(data.length>7*1024*1024)throw new IOException("Private proactive snapshot exceeds limit");
    long next=Math.max(System.currentTimeMillis(),stamp+1);
    String name=String.format(Locale.ROOT,"%016d",next)+"-"+UUID.randomUUID()+".enc";
    File file=new File(folder,name);byte[] encrypted=seal(data,"proactive:"+name,key);
    if(!file.createNewFile())throw new IOException("Private proactive snapshot already exists");
    try(FileOutputStream out=new FileOutputStream(file,false)){out.write(encrypted);out.getFD().sync();}
    stamp=next;return file;
  }
  private static byte[] read(File file)throws IOException {
    if(file.length()>8*1024*1024)throw new IOException("Private proactive record exceeds limit");
    try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){
      byte[] buffer=new byte[8192];int n;
      while((n=in.read(buffer))!=-1){if(out.size()+n>8*1024*1024)throw new IOException("Private proactive record exceeds limit");out.write(buffer,0,n);}
      return out.toByteArray();
    }
  }
  static byte[] seal(byte[] data,String aad,SecretKey key)throws Exception {
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);
    cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));byte[] iv=cipher.getIV();
    ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(new byte[]{'O','W','E','1',(byte)iv.length});out.write(iv);out.write(cipher.doFinal(data));return out.toByteArray();
  }
  static byte[] open(byte[] data,String aad,SecretKey key)throws Exception {
    if(data.length<33||data[0]!='O'||data[1]!='W'||data[2]!='E'||data[3]!='1'||data[4]!=12)throw new IOException("Invalid ciphertext");
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Arrays.copyOfRange(data,5,17)));
    cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));return cipher.doFinal(Arrays.copyOfRange(data,17,data.length));
  }
}
