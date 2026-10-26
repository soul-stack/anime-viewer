Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
appDir = objFSO.GetParentFolderName(WScript.ScriptFullName)

' 静默调用 start.bat（隐藏 cmd 窗口），由 start.bat 处理环境变量和启动
batPath = appDir & "\start.bat"
If objFSO.FileExists(batPath) Then
    objShell.CurrentDirectory = appDir
    objShell.Run """" & batPath & """", 0, False
Else
    MsgBox "找不到 start.bat" & vbCrLf & batPath, 16, "AniView 启动失败"
End If
