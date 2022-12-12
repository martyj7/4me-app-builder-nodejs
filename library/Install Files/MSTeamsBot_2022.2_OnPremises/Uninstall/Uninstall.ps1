#Rename Site name  if its different
Remove-WebApplication -Site "Default Web Site" -Name IvantiBotService

#Remove new App pool
Remove-WebAppPool -Name "BotServiceAppPool"

#Copy required binary files to destination folder
Remove-Item "$env:systemdrive\inetpub\TeamsBotService" -Recurse

