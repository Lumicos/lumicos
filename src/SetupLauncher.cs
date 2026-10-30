using System;
using System.IO;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
[assembly: System.Reflection.AssemblyTitle("Lumicos Setup")]
[assembly: System.Reflection.AssemblyProduct("Lumicos")]
[assembly: System.Reflection.AssemblyVersion("0.2.3.0")]
class LumicosSetup {
 [STAThread]
 static int Main() {
  string root=AppDomain.CurrentDomain.BaseDirectory;
  string script=Path.Combine(root,"Bootstrap.ps1");
  if(!File.Exists(script)){MessageBox.Show("Extract the complete Lumicos installer ZIP before running Setup.","Lumicos Setup");return 1;}
  Console.Title="Lumicos Setup";
  string destination=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Lumicos");
  Application.EnableVisualStyles();
  using(var form=new Form()) {
   form.Text="Lumicos Setup 0.2.3 — Beta";form.ClientSize=new Size(480,700);form.StartPosition=FormStartPosition.CenterScreen;
   form.FormBorderStyle=FormBorderStyle.FixedDialog;form.MaximizeBox=false;form.BackColor=Color.FromArgb(3,10,23);form.ForeColor=Color.White;
   var iconPath=Path.Combine(root,"assets/lumicos.ico");if(File.Exists(iconPath))form.Icon=new Icon(iconPath);
   var logoPath=Path.Combine(root,"assets/lumicos-logo.png");
   var logo=new PictureBox {Bounds=new Rectangle(30,10,420,420),SizeMode=PictureBoxSizeMode.Zoom};
   if(File.Exists(logoPath))logo.Image=Image.FromFile(logoPath);form.Controls.Add(logo);
   form.Controls.Add(new Label {Text="Your personal AI workspace",TextAlign=ContentAlignment.MiddleCenter,Bounds=new Rectangle(20,432,440,30),Font=new Font("Segoe UI",13)});
   form.Controls.Add(new Label {Text="Automatically detect hardware and install the recommended profile.\nCPU speech; CPU Whisper when GPU support is unavailable.\nInternet required. AI models download separately.",TextAlign=ContentAlignment.MiddleCenter,Bounds=new Rectangle(20,470,440,64),Font=new Font("Segoe UI",10)});
   form.Controls.Add(new Label {Text="Install folder (new folder required for older versions)",Bounds=new Rectangle(40,548,400,20)});
   var folder=new TextBox {Text=destination,Bounds=new Rectangle(40,575,400,25)};form.Controls.Add(folder);
   var next=new Button {Text="Install Lumicos",DialogResult=DialogResult.OK,Bounds=new Rectangle(245,630,195,42),BackColor=Color.FromArgb(0,111,190),FlatStyle=FlatStyle.Flat};
   var cancel=new Button {Text="Cancel",DialogResult=DialogResult.Cancel,Bounds=new Rectangle(40,630,180,42),FlatStyle=FlatStyle.Flat};
   form.Controls.Add(next);form.Controls.Add(cancel);form.AcceptButton=next;form.CancelButton=cancel;
   if(Environment.GetCommandLineArgs().Length>1 && Environment.GetCommandLineArgs()[1]=="--preview") {var timer=new Timer {Interval=2500};timer.Tick+=(s,e)=>{timer.Stop();form.Close();};timer.Start();form.ShowDialog();if(logo.Image!=null)logo.Image.Dispose();return 0;}
   var result=form.ShowDialog();if(logo.Image!=null)logo.Image.Dispose();if(result!=DialogResult.OK)return 0;
   destination=folder.Text.Trim();
   if(String.IsNullOrWhiteSpace(destination)||destination.IndexOfAny(new char[]{'"','\r','\n','%','&','|','<','>','^','!'})>=0){MessageBox.Show("Choose a valid local installation folder.","Lumicos Setup");return 1;}
  }
  var info=new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -File \""+script+"\" -Mode install -Yes -AcceptCpuWhisper -Root \""+destination.TrimEnd('\\')+"\"");
  info.UseShellExecute=false;info.WorkingDirectory=root;
  using(var process=Process.Start(info)){process.WaitForExit();if(process.ExitCode!=0){Console.WriteLine("Setup did not finish. Press Enter to close.");Console.ReadLine();}return process.ExitCode;}
 }
}
