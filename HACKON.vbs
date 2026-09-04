' HACK:ON — 콘솔 창 없이 켠다. 바탕화면에 바로가기를 만들어 두면 진짜 프로그램처럼 쓴다.
' 검은 창이 잠깐도 안 보인다. 하는 일은 HACKON.bat 과 같다.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
sh.Run "node """ & here & "\desktop.js""", 0, False
