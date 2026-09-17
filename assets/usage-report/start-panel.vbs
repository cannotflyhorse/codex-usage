' Launch the usage panel as a detached, windowless background process.
' Kept ASCII-only on purpose: VBScript reads this file with the system codepage.
Option Explicit

Dim shell, fso, base, logDir, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = fso.BuildPath(base, "logs")
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)

shell.CurrentDirectory = base
cmd = "cmd /c node server.js > logs\panel.log 2>&1"
shell.Run cmd, 0, False
