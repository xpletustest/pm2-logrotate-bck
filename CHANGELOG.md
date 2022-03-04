# 2.7.6
- added: include timestamp to log messages
- changed: disabled all PMX / metrics related code   
  (was causing issues, because it accesses incorrect paths)

# 2.7.5
- rebased on https://github.com/jessety/pm2-logrotate v2.7.4
- changed: using our custom pm2 repos as a dependency (needed to fix issues with multiple instances)
