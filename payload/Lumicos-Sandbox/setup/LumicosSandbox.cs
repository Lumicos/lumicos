// LumicosSandbox.exe - starts one process inside the Lumicos AppContainer + Job Object.
// Based on the Phase 4A WorkerSupervisor (same AppContainer SID), with bigger limits,
// optional internet (internetClient capability: internet yes, localhost/LAN no),
// child processes, and extra environment variables.
//
// Usage: LumicosSandbox.exe --sid SID --exe PATH --cwd DIR [--timeout-ms N] [--memory-mb N]
//          [--cpu-percent N] [--procs N] [--net 0|1] [--env K=V]... -- args...
// Prints one JSON object on stdout and exits 0 (the child's exit code is inside the JSON).
using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class LumicosSandbox {
  const uint EXTENDED_STARTUPINFO_PRESENT=0x00080000,CREATE_SUSPENDED=0x4,CREATE_UNICODE_ENVIRONMENT=0x400,CREATE_NO_WINDOW=0x08000000;
  const uint LIMIT_ACTIVE_PROCESS=0x8,LIMIT_JOB_MEMORY=0x200,LIMIT_DIE_ON_UNHANDLED_EXCEPTION=0x400,LIMIT_KILL_ON_JOB_CLOSE=0x2000;
  const uint CPU_ENABLE=1,CPU_HARD_CAP=4,WAIT_TIMEOUT=258; const int ATTR_SECURITY_CAPABILITIES=0x00020009;
  const uint SE_GROUP_ENABLED=0x4;
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUPINFO {public int cb;public string r,d,t;public int x,y,xs,ys,xc,yc;public int fill,flags;public short show,cb2;public IntPtr reserved2,stdin,stdout,stderr;}
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX {public STARTUPINFO si;public IntPtr attrs;}
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION {public IntPtr process,thread;public uint pid,tid;}
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES {public IntPtr sid,capabilities;public uint count,reserved;}
  [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES {public IntPtr sid;public uint attributes;}
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT {public long processTime,jobTime;public uint flags;public UIntPtr min,max;public uint active;public UIntPtr affinity;public uint priority,scheduling;}
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS {public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes;}
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT {public BASIC_LIMIT basic;public IO_COUNTERS io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
  [StructLayout(LayoutKind.Sequential)] struct CPU_RATE {public uint flags,rate;}
  [DllImport("kernel32",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr p,int count,int flags,ref IntPtr size);
  [DllImport("kernel32",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr p,uint flags,IntPtr attr,IntPtr value,IntPtr size,IntPtr prev,IntPtr ret);
  [DllImport("kernel32")] static extern void DeleteProcThreadAttributeList(IntPtr p);
  [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFOEX si,out PROCESS_INFORMATION pi);
  [DllImport("kernel32",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string n);
  [DllImport("kernel32",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,ref EXTENDED_LIMIT info,uint len);
  [DllImport("kernel32",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,ref CPU_RATE info,uint len);
  [DllImport("kernel32",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,ref uint info,uint len);
  [DllImport("kernel32",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int cls,ref EXTENDED_LIMIT info,uint len,IntPtr ret);
  [DllImport("kernel32",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32")] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32")] static extern bool GetExitCodeProcess(IntPtr p,out uint code);
  [DllImport("kernel32")] static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSidToSid(string s,out IntPtr sid);
  [DllImport("kernel32")] static extern IntPtr LocalFree(IntPtr p);
  static void Win(string what){int code=Marshal.GetLastWin32Error();throw new Win32Exception(code,what+" (Win32 "+code+")");}
  static string J(string s){if(s==null)return "null";var b=new StringBuilder("\"");foreach(char c in s){if(c=='"'||c=='\\'){b.Append('\\').Append(c);}else if(c<32){b.Append("\\u").Append(((int)c).ToString("x4"));}else b.Append(c);}return b.Append('"').ToString();}
  static string Quote(string a){if(a.Length>0&&a.IndexOfAny(new[]{' ','\t','"'})<0)return a;var b=new StringBuilder("\"");int bs=0;foreach(char c in a){if(c=='\\'){bs++;continue;}if(c=='"'){b.Append('\\',bs*2+1).Append('"');bs=0;continue;}b.Append('\\',bs).Append(c);bs=0;}b.Append('\\',bs*2).Append('"');return b.ToString();}

  public static int Main(string[] argv){
    string sidText=null,exe=null,cwd=null;int timeoutMs=120000,memoryMb=2048,cpuPercent=50,procs=16;bool net=false;var env=new List<string>();var childArgs=new List<string>();
    for(int i=0;i<argv.Length;i++){string a=argv[i];
      if(a=="--"){for(int k=i+1;k<argv.Length;k++)childArgs.Add(argv[k]);break;}
      string v=i+1<argv.Length?argv[i+1]:null;
      switch(a){case "--sid":sidText=v;i++;break;case "--exe":exe=v;i++;break;case "--cwd":cwd=v;i++;break;
        case "--timeout-ms":timeoutMs=int.Parse(v);i++;break;case "--memory-mb":memoryMb=int.Parse(v);i++;break;
        case "--cpu-percent":cpuPercent=int.Parse(v);i++;break;case "--procs":procs=int.Parse(v);i++;break;
        case "--net":net=v=="1";i++;break;case "--env":env.Add(v);i++;break;
        default:Console.Out.Write("{\"started\":false,\"error\":"+J("unknown option "+a)+"}");return 2;}}
    bool started=false,timedOut=false;uint exitCode=0,pid=0;string error=null;long peak=0;var watch=Stopwatch.StartNew();
    IntPtr attrs=IntPtr.Zero,scPtr=IntPtr.Zero,sid=IntPtr.Zero,capSid=IntPtr.Zero,capArr=IntPtr.Zero,envPtr=IntPtr.Zero,job=IntPtr.Zero;PROCESS_INFORMATION pi=new PROCESS_INFORMATION();
    try{
      if(sidText==null||exe==null||cwd==null)throw new ArgumentException("--sid, --exe and --cwd are required");
      if(!ConvertStringSidToSid(sidText,out sid))Win("ConvertStringSidToSid");
      uint capCount=0;
      if(net){ // internetClient: outbound internet only. Loopback/LAN stay blocked by AppContainer.
        if(!ConvertStringSidToSid("S-1-15-3-1",out capSid))Win("capability SID");
        var cap=new SID_AND_ATTRIBUTES{sid=capSid,attributes=SE_GROUP_ENABLED};capArr=Marshal.AllocHGlobal(Marshal.SizeOf(cap));Marshal.StructureToPtr(cap,capArr,false);capCount=1;}
      IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);attrs=Marshal.AllocHGlobal(size);if(!InitializeProcThreadAttributeList(attrs,1,0,ref size))Win("InitializeProcThreadAttributeList");
      var sc=new SECURITY_CAPABILITIES{sid=sid,capabilities=capArr,count=capCount,reserved=0};scPtr=Marshal.AllocHGlobal(Marshal.SizeOf(sc));Marshal.StructureToPtr(sc,scPtr,false);
      if(!UpdateProcThreadAttribute(attrs,0,(IntPtr)ATTR_SECURITY_CAPABILITIES,scPtr,(IntPtr)Marshal.SizeOf(sc),IntPtr.Zero,IntPtr.Zero))Win("UpdateProcThreadAttribute");
      job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)Win("CreateJobObject");
      var limit=new EXTENDED_LIMIT();limit.basic.flags=LIMIT_ACTIVE_PROCESS|LIMIT_JOB_MEMORY|LIMIT_DIE_ON_UNHANDLED_EXCEPTION|LIMIT_KILL_ON_JOB_CLOSE;limit.basic.active=(uint)Math.Max(1,procs);limit.jobMemory=(UIntPtr)((ulong)memoryMb*1024UL*1024UL);
      if(!SetInformationJobObject(job,9,ref limit,(uint)Marshal.SizeOf(limit)))Win("Job limits");
      var cpu=new CPU_RATE{flags=CPU_ENABLE|CPU_HARD_CAP,rate=(uint)(Math.Max(1,Math.Min(100,cpuPercent))*100)};if(!SetInformationJobObject(job,15,ref cpu,(uint)Marshal.SizeOf(cpu)))Win("CPU cap");
      uint ui=0xFF;if(!SetInformationJobObject(job,4,ref ui,4))Win("UI restrictions");
      string[] allowed={"ALLUSERSPROFILE","CommonProgramFiles","CommonProgramFiles(x86)","CommonProgramW6432","ComSpec","NUMBER_OF_PROCESSORS","OS","Path","PATHEXT","PROCESSOR_ARCHITECTURE","PROCESSOR_IDENTIFIER","PROCESSOR_LEVEL","PROCESSOR_REVISION","ProgramData","ProgramFiles","ProgramFiles(x86)","ProgramW6432","PUBLIC","SystemDrive","SystemRoot","WINDIR"};
      var vars=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);foreach(string name in allowed){string value=Environment.GetEnvironmentVariable(name);if(!String.IsNullOrEmpty(value))vars[name]=value;}
      foreach(string kv in env){int eq=kv.IndexOf('=');if(eq>0)vars[kv.Substring(0,eq)]=kv.Substring(eq+1);}
      var keys=new List<string>(vars.Keys);keys.Sort(StringComparer.OrdinalIgnoreCase);var block=new StringBuilder();foreach(var k in keys)block.Append(k).Append('=').Append(vars[k]).Append('\0');block.Append('\0');
      byte[] envBytes=Encoding.Unicode.GetBytes(block.ToString());envPtr=Marshal.AllocHGlobal(envBytes.Length);Marshal.Copy(envBytes,0,envPtr,envBytes.Length);
      var cmd=new StringBuilder(Quote(exe));foreach(var a in childArgs)cmd.Append(' ').Append(Quote(a));
      var sx=new STARTUPINFOEX();sx.si.cb=Marshal.SizeOf(sx);sx.attrs=attrs;
      if(!CreateProcessW(exe,cmd,IntPtr.Zero,IntPtr.Zero,false,EXTENDED_STARTUPINFO_PRESENT|CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|CREATE_NO_WINDOW,envPtr,cwd,ref sx,out pi))Win("CreateProcess AppContainer");
      started=true;pid=pi.pid;
      if(!AssignProcessToJobObject(job,pi.process)){TerminateJobObject(job,5);Win("AssignProcessToJobObject");}
      if(ResumeThread(pi.thread)==0xFFFFFFFF)Win("ResumeThread");
      uint wait=WaitForSingleObject(pi.process,(uint)timeoutMs);
      if(wait==WAIT_TIMEOUT){timedOut=true;TerminateJobObject(job,1460);WaitForSingleObject(pi.process,5000);}
      GetExitCodeProcess(pi.process,out exitCode);
      TerminateJobObject(job,0); // kill leftover children
      var info=new EXTENDED_LIMIT();if(QueryInformationJobObject(job,9,ref info,(uint)Marshal.SizeOf(info),IntPtr.Zero))peak=(long)(ulong)info.peakJob;
    }catch(Exception e){error=e.Message;if(job!=IntPtr.Zero)TerminateJobObject(job,5);}
    finally{watch.Stop();if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);if(pi.process!=IntPtr.Zero)CloseHandle(pi.process);if(job!=IntPtr.Zero)CloseHandle(job);if(attrs!=IntPtr.Zero){DeleteProcThreadAttributeList(attrs);Marshal.FreeHGlobal(attrs);}if(scPtr!=IntPtr.Zero)Marshal.FreeHGlobal(scPtr);if(capArr!=IntPtr.Zero)Marshal.FreeHGlobal(capArr);if(capSid!=IntPtr.Zero)LocalFree(capSid);if(sid!=IntPtr.Zero)LocalFree(sid);if(envPtr!=IntPtr.Zero)Marshal.FreeHGlobal(envPtr);}
    Console.Out.Write("{\"started\":"+(started?"true":"false")+",\"timedOut\":"+(timedOut?"true":"false")+",\"exitCode\":"+exitCode+",\"pid\":"+pid+",\"wallMs\":"+watch.ElapsedMilliseconds+",\"peakMemoryBytes\":"+peak+",\"error\":"+J(error)+"}");
    return 0;
  }
}
