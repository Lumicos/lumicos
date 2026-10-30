using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Drawing;
using System.Windows.Forms;
[assembly: AssemblyTitle("Lumicos Setup")]
[assembly: AssemblyProduct("Lumicos")]
[assembly: AssemblyVersion("0.2.3.0")]
class SingleFileSetup {
 static void Extract(string root,Action<int> progress) {
  using(var resource=Assembly.GetExecutingAssembly().GetManifestResourceStream("lumicos.package.zip")){
   if(resource==null)throw new Exception("Missing embedded installer package.");
   using(var sha=SHA256.Create()){
    string digest=BitConverter.ToString(sha.ComputeHash(resource)).Replace("-","").ToLowerInvariant();
    if(digest!=PackageDigest.Value)throw new Exception("Installer package checksum mismatch.");
   }
   resource.Position=0;
   using(var archive=new ZipArchive(resource,ZipArchiveMode.Read)){
    int done=0;
    foreach(var entry in archive.Entries){
     string name=entry.FullName.Replace('/',Path.DirectorySeparatorChar);
     if(Path.IsPathRooted(name)||name.IndexOf(':')>=0)throw new Exception("Unsafe archive path.");
     foreach(string part in name.Split(Path.DirectorySeparatorChar))if(part=="..")throw new Exception("Unsafe archive path.");
     string target=Path.GetFullPath(Path.Combine(root,name));
     if(!target.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("Archive path escapes destination.");
     if(String.IsNullOrEmpty(entry.Name)){Directory.CreateDirectory(target);continue;}
     Directory.CreateDirectory(Path.GetDirectoryName(target));
     using(var input=entry.Open())using(var output=new FileStream(target,FileMode.CreateNew,FileAccess.Write))input.CopyTo(output);
     if(progress!=null)progress(++done*100/archive.Entries.Count);
    }
   }
  }
 }
 [STAThread]
 static int Main(string[] args){
  string root=null;bool test=args.Length==2&&args[0]=="--extract-only";
  try{
   if(test){root=Path.GetFullPath(args[1]);if(Directory.Exists(root)||File.Exists(root))throw new Exception("Test destination must not exist.");}
   else root=Path.Combine(Path.GetTempPath(),"LumicosSetup-"+Guid.NewGuid().ToString("N"));
   Directory.CreateDirectory(root);
   if(test){Extract(root,null);return 0;}
   Application.EnableVisualStyles();
   using(var form=new Form()){
    form.Text="Lumicos Setup";form.ClientSize=new Size(420,100);form.StartPosition=FormStartPosition.CenterScreen;form.ControlBox=false;form.FormBorderStyle=FormBorderStyle.FixedDialog;
    var label=new Label {Text="Preparing Lumicos installer…",Bounds=new Rectangle(20,15,380,25)};
    var bar=new ProgressBar {Bounds=new Rectangle(20,50,380,22)};form.Controls.Add(label);form.Controls.Add(bar);form.Show();
    Extract(root,n=>{bar.Value=n;Application.DoEvents();});form.Close();
   }
   var start=new ProcessStartInfo(Path.Combine(root,"Lumicos-Setup.exe"));start.UseShellExecute=false;start.WorkingDirectory=root;
   if(args.Length==1&&args[0]=="--preview")start.Arguments="--preview";
   using(var child=Process.Start(start)){child.WaitForExit();return child.ExitCode;}
  }catch(Exception e){if(test){if(root!=null)File.WriteAllText(root+".error.txt",e.ToString());}else MessageBox.Show(e.Message,"Lumicos Setup",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
  finally{
   // Delete only this process's randomly generated extraction folder; retain test output.
   if(!test&&root!=null&&Path.GetDirectoryName(root)==Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar)&&Path.GetFileName(root).StartsWith("LumicosSetup-"))try{Directory.Delete(root,true);}catch{}
  }
 }
}
