#Provide IP Address of the App server and Central Config machine
 param (
    [string]$AppserverIPAddress = $( Read-Host "Please enter the app server IP address or host/domain name :" ),
    [string]$CentralConfigIPAddress = $( Read-Host "Please enter the Central Config server IP address or host/domain name :" )
 )

#Create a directory in a inetpub folder
mkdir "$env:systemdrive\inetpub\TeamsBotService"

#Create new App pool
New-WebAppPool -Name "BotServiceAppPool"
Set-ItemProperty -Path IIS:\AppPools\BotServiceAppPool managedRuntimeVersion ""

#Rename Site name  if its different
New-WebApplication -Site "Default Web Site" -Name IvantiBotService -PhysicalPath "$env:systemdrive\inetpub\TeamsBotService" -ApplicationPool "BotServiceAppPool"

#silent install required application
$ScriptDir = Get-Location
Start-Process -Wait -ArgumentList "/silent" -PassThru -FilePath "$ScriptDir\dotnet-hosting-5.0.15-win.exe"

#Copy required binary files to destination folder
Copy-Item -Path "TeamBot\*" -Destination "$env:systemdrive\inetpub\TeamsBotService" -Recurse

#Change the URL if provide path is not correct
$jsonBase = @{"MicrosoftAppId"="";"MicrosoftAppPassword"="";"IPCMURL"= "http://$AppserverIPAddress/HEAT/ServiceApi/IPCMService.asmx"; "WorkflowURL"= "http://$AppserverIPAddress/HEAT/ServiceApi/WorkflowService.asmx"; "ConfigURL"= "http://$CentralConfigIPAddress/CentralConfig/ConfigServiceAPI.asmx"; "RetrieveTenantLogLevel_ws_url"= "http://$CentralConfigIPAddress/CentralConfig/RetrieveTenantLogLevel.ashx"; "EnableCentralLogging"= "false";  "LoggingService_ws_url"= "http://$AppserverIPAddress/Heat.Logging.Service/api/LoggingService/HeatServiceManagementLogging"; "ElapsedSecondsToFlushLog"= 60; "ItemSizeToFlushLog"= 1000; "LogSettingCacheTimeoutInMinutes"= 5; "SendLogFileLocation"= "C:\logs"; "WriteLogFileLocation"= "C:\logs"; "SendLogWaitInterval"= 300; "WriteLogWaitInterval"= 300; "EnableLogging"= "true"; "CacheTimeout"= "30"; "isOnPremise"= "true"; "CentralConfigApiKey"= "" }

#create appsetting JSON file
$jsonBase | ConvertTo-Json -Depth 10 | Out-File "$env:systemdrive\inetpub\TeamsBotService\appsettings.json"

#New-Item -Path "$env:systemdrive\inetpub\TeamsBotService" -Name "appsettings.json" -ItemType "file" -Value $json
