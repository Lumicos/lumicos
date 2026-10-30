using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class LumicosDxgi {
 [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid id,out IntPtr factory);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int EnumAdapters1(IntPtr self,uint index,out IntPtr adapter);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetDesc1(IntPtr self,out Desc description);
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Desc {
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string Description;
  public uint VendorId,DeviceId,SubSysId,Revision;
  public UIntPtr DedicatedVideoMemory,DedicatedSystemMemory,SharedSystemMemory;
  public uint LowPart;public int HighPart;public uint Flags;
 }
 public class Adapter {public string Name;public ulong DedicatedBytes;public uint VendorId;}
 static Delegate Slot(IntPtr obj,int slot,Type type){return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(obj),slot*IntPtr.Size),type);}
 public static Adapter[] Read(){
  var result=new List<Adapter>();IntPtr factory=IntPtr.Zero;Guid guid=new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
  if(CreateDXGIFactory1(ref guid,out factory)<0)return result.ToArray();
  try{var enumerate=(EnumAdapters1)Slot(factory,12,typeof(EnumAdapters1));
   for(uint i=0;i<32;i++){IntPtr adapter;if(enumerate(factory,i,out adapter)<0)break;
    try{Desc d;if(((GetDesc1)Slot(adapter,10,typeof(GetDesc1)))(adapter,out d)==0&&(d.Flags&2)==0)result.Add(new Adapter{Name=d.Description,DedicatedBytes=d.DedicatedVideoMemory.ToUInt64(),VendorId=d.VendorId});}
    finally{Marshal.Release(adapter);}
   }
  }finally{Marshal.Release(factory);}return result.ToArray();
 }
}
