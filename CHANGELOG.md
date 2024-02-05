# 2.8.3
- removed: rotation of PM2 logs (rotation is done by winsw)

# 2.8.2
- updated: pm2

# 2.8.1
- changed: reduced default value for retain to 10
- removed: GitHub workflow

# 2.8.0
- added: lots of logging
- added: jsdoc comments with type hings
- fixed: incorrect URLS in package.json
- changed: default workerInterval to 10 seconds 
- factored: out getPM2RootPath, getFinalTime, getFileBaseName, getFinalName
- fixed: final name was incorrect when extension was not .log
- fixed: delete_old was not working on Windows
- fixed: replaced all var usage with const or let
- fixed: code formatting
- fixed: duplicate code in pm2.connect callback, factored out to proceed_apps function
- fixed: logs of PM2 were not rotated on new day
- fixed: multiple instances of app with different log paths were not correctly handled 
  (see has_same_logs)
- added: more explaining comments
- removed: unused code

# 2.7.6
- added: include timestamp to log messages
- changed: disabled all PMX / metrics related code   
  (was causing issues, because it accesses incorrect paths)

# 2.7.5
- rebased on https://github.com/jessety/pm2-logrotate v2.7.4
- changed: using our custom pm2 repos as a dependency (needed to fix issues with multiple instances)
