const fs = require("graceful-fs");
const path = require("path");
const pmx = require("pmx");
const pm2 = require("pm2");
const moment = require("moment-timezone");
const scheduler = require("node-schedule");
const zlib = require("zlib");
const util = require("util");

///
/// ENTRY POINT
///
const conf = pmx.initModule({
  widget: {
    type: "generic",
    logo: "https://raw.githubusercontent.com/pm2-hive/pm2-logrotate/master/pres/logo.png",
    theme: ["#111111", "#1B2228", "#31C2F1", "#807C7C"],
    el: {
      probes: false,
      actions: false,
    },
    block: {
      issues: true,
      cpu: true,
      mem: true,
      actions: true,
      main_probes: ["Global logs size", "Files count"],
    },
  },
});

const PM2_ROOT_PATH = getPM2RootPath();
const WORKER_INTERVAL = isNaN(parseInt(conf.workerInterval))
  ? 30 * 1000
  : parseInt(conf.workerInterval) * 1000; // default: 30 secs
const SIZE_LIMIT = get_limit_size(); // default : 10MB
const ROTATE_CRON = conf.rotateInterval || "0 0 * * *"; // default : every day at midnight
const RETAIN = isNaN(parseInt(conf.retain)) ? undefined : parseInt(conf.retain); // All
const COMPRESSION = JSON.parse(conf.compress) || false; // Do not compress by default
const DATE_FORMAT = conf.dateFormat || "YYYY-MM-DD_HH-mm-ss";
const TZ = conf.TZ;
const ROTATE_MODULE = JSON.parse(conf.rotateModule) || true;
const WATCHED_FILES = [];

log("\n\nStarting pm2-logrotate v" + require("./package.json").version);
log_config();

// Connect to local PM2 and schedule the rotation process
pm2.connect(
  (err) => {
    if (err) 
      return error(err.stack || err);    

    // start background task (execute at WORKER_INTERVAL)
    setInterval(() => {
      log("interval triggered");
      proceed_apps(false); // not forced rotation (only rotate if size > limit)

      // rotate pm2 logs
      proceed_file(path.join(PM2_ROOT_PATH, "pm2.log"), false);
      proceed_file(path.join(PM2_ROOT_PATH, "agent.log"), false);
    }, WORKER_INTERVAL);

    // register the cron to force rotate file (default = every day at midnight)
    scheduler.scheduleJob(ROTATE_CRON, () => {
      log("cron triggered");
      proceed_apps(true); // forced rotation (at start of new day)

      // rotate pm2 logs
      proceed_file(path.join(PM2_ROOT_PATH, "pm2.log"), true);
      proceed_file(path.join(PM2_ROOT_PATH, "agent.log"), true);
    });
  }
);

function log_config() {
  log("conf: \n" + inspect(conf) + "\n");
  log("PM2_ROOT_PATH: " + PM2_ROOT_PATH);
  log("WORKER_INTERVAL: " + WORKER_INTERVAL);
  log("SIZE_LIMIT: " + SIZE_LIMIT);
  log("ROTATE_CRON: " + ROTATE_CRON);
  log("RETAIN: " + RETAIN);
  log("COMPRESSION: " + COMPRESSION);
  log("DATE_FORMAT: " + DATE_FORMAT);
  log("TZ: " + TZ);
  log("ROTATE_MODULE: " + ROTATE_MODULE);
}
function log(msg) {
  console.log(new Date().toLocaleString() + " " + msg);
}
function error(err) {
  console.error(new Date().toLocaleString() + " " + err);
}
function inspect(item) {
  return util.inspect(item, {
    showHidden: false,
    depth: 8,
    maxArrayLength: 25,
    maxStringLength: 255,
    compact: 10,
    sorted: false,
  });
}
function notify_error(err) {
  error(err);
  pmx.notify(err);
}

/**
 * Get PM2 root path from environment variables
 */
function getPM2RootPath() {
  if (process.env.PM2_HOME) 
    return process.env.PM2_HOME;  
  if (process.env.HOME && !process.env.HOMEPATH) 
    return path.resolve(process.env.HOME, ".pm2");  
  if (process.env.HOME || process.env.HOMEPATH) 
    return path.resolve(
      process.env.HOMEDRIVE,
      process.env.HOME || process.env.HOMEPATH,
      ".pm2"
    );  
  return "";
}

/**
 * Parse the `max_size` string and return the size in bytes.
 */
function get_limit_size() {
  if (conf.max_size === "") 
    return 1024 * 1024 * 10;  
  if (typeof conf.max_size !== "string") 
    conf.max_size = conf.max_size + "";  
  if (conf.max_size.slice(-1) === "G") 
    return parseInt(conf.max_size) * 1024 * 1024 * 1024;  
  if (conf.max_size.slice(-1) === "M") 
    return parseInt(conf.max_size) * 1024 * 1024;  
  if (conf.max_size.slice(-1) === "K") 
    return parseInt(conf.max_size) * 1024;  
  return parseInt(conf.max_size);
}

/**
 * Delete all rotated files except the `RETAIN` newest.
 * 
 * @param {string} file
 */
function delete_old(file) {
  if (file === "/dev/null") 
    return;

  const fileBaseName = path.basename(getFileBaseName(file));
  const dirName = path.dirname(file);

  fs.readdir(dirName, (err, files) => {
    if (err) 
      return notify_error(err); 

    const rotated_files = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].indexOf(fileBaseName) >= 0) 
        rotated_files.push(files[i]);      
    }
    // sort newest to oldest
    rotated_files.sort().reverse();

    // keep RETAIN newest files
    for (let i = rotated_files.length - 1; i >= RETAIN; i--) {
      ((rotated_file) => {
        fs.unlink(path.resolve(dirName, rotated_file), (err) => {
          if (err) {
            return error(err);
          }
          log('"' + rotated_file + '" has been deleted');
        });
      })(rotated_files[i]);
    }
  });
}

/**
  * Get timestamp string to use in rotated file name
  */
function getFinalTime() {
  // set default final time
  let final_time = moment().format(DATE_FORMAT);
  // check for a timezone
  if (TZ) {
    try {
      final_time = moment().tz(TZ).format(DATE_FORMAT);
    } catch (err) {
      // use default
    }
  }
  return final_time;
}

/**
  * Get base file name - i.e. without file extension, but with '__' at the end
  * 
  * @param {string} file
  */
function getFileBaseName(file) {
  // Get base file name - i.e. without file extension : remove everything after the last dot (up to then end of string)
  const base_file_name = file.replace(/\.[^\.]+$/, '');
  return base_file_name + '__';   
}

/**
  * Get full path of file after rotation
  * 
  * @param {string} file
  */
function getFinalName(file) {  
  // Get file extension: replace everything by string after the last dot
  const file_ext = file.replace(/^.*\.([^\.]*)$/i, '$1')
  // Build final filename with base + time + extension
  let final_name = getFileBaseName(file) + getFinalTime() + '.' + file_ext;
  if (COMPRESSION) 
    final_name += ".gz";  
  return final_name;
}

/**
 * Apply the rotation process of the log file.
 *
 * @param {string} file
 */
function proceed(file) {

  let final_name = getFinalName(file);
  // if compression is enabled, add gz extension and create a gzip instance
  let GZIP;
  if (COMPRESSION) 
    GZIP = zlib.createGzip({ level: zlib.Z_BEST_COMPRESSION,  memLevel: zlib.Z_BEST_COMPRESSION });
  
  // create our read/write streams
  const readStream = fs.createReadStream(file);
  const writeStream = fs.createWriteStream(final_name, { flags: "w+" });

  // pipe whole stream
  if (COMPRESSION) 
    readStream.pipe(GZIP).pipe(writeStream);
  else 
    readStream.pipe(writeStream); 

  // listen for errors
  readStream.on("error", notify_error);
  writeStream.on("error", notify_error);
  if (COMPRESSION) 
    GZIP.on("error", notify_error);  

  // when the read is done, empty the file and check for retain option
  writeStream.on("finish", () => {
    if (GZIP) 
      GZIP.close();    
    readStream.close();
    writeStream.close();

    // final file has been created, empty the original file
    fs.truncate(file, (err) => {
      if (err) 
        return notify_error(err);
      
        log('"' + final_name + '" has been created');
        log('"' + file + '" has been emptied');      

      if (typeof RETAIN === "number") 
        delete_old(file);      
    });
  });
}

/**
 * Apply the rotation process if the `file` size exceeds the `SIZE_LIMIT`.
 *
 * @param {string} file
 * @param {boolean} force - Do not check the SIZE_LIMIT and rotate every time.
 */
function proceed_file(file, force) {
  if (!fs.existsSync(file)) 
    return;

  if (!WATCHED_FILES.includes(file)) 
    WATCHED_FILES.push(file);  

  fs.stat(file, 
    (err, data) => {
      if (err) 
        return error(err);      

      if (data.size > 0 && (data.size >= SIZE_LIMIT || force)) {
        log("proceed_file: " + file + ", forced: " + force);
        proceed(file);
      }
    });
}

/**
 * Apply the rotation process of all log files of `app` where the file size exceeds the`SIZE_LIMIT`.
 *
 * @param {Object} app
 * @param {boolean} force - Do not check the SIZE_LIMIT and rotate every time.
 */
function proceed_app(app, force) {
  // Check all log paths
  // Note: If same file is defined for multiple purposes, it will be processed only once
  if (app.pm2_env.pm_out_log_path) 
    proceed_file(app.pm2_env.pm_out_log_path, force);

  if (app.pm2_env.pm_err_log_path && 
      app.pm2_env.pm_err_log_path !== app.pm2_env.pm_out_log_path) 
    proceed_file(app.pm2_env.pm_err_log_path, force);
  
  if (app.pm2_env.pm_log_path && 
      app.pm2_env.pm_log_path !== app.pm2_env.pm_out_log_path &&
      app.pm2_env.pm_log_path !== app.pm2_env.pm_err_log_path) 
    proceed_file(app.pm2_env.pm_log_path, force);  
}

/**
 * Check if both apps have the exact same log paths
 *
 * @param {Object} app1
 * @param {Object} app2  
 */
function has_same_logs(app1, app2) {
  // return true only if all log paths are identical
  if (!app1 || !app2) return false;
  if (app1.pm2_env.pm_out_log_path !== app2.pm2_env.pm_out_log_path) return false;
  if (app1.pm2_env.pm_err_log_path !== app2.pm2_env.pm_err_log_path) return false;
  if (app1.pm2_env.pm_log_path !== app2.pm2_env.pm_log_path) return false;
  return true;
}

/**
 * Apply the rotation process of log files of all suitable apps 
 *
 * @param {boolean} force - Do not check the SIZE_LIMIT and rotate regardless of the size.
 */
function proceed_apps(force) {
  // get list of process managed by pm2
  pm2.list((err, apps) => {
    if (err) 
      return error(err.stack || err);    
    log("apps: " + JSON.stringify(apps.map((app) => app.name)));

    const appMap = {};
    apps.forEach((app) => {
      // if its a module and ROTATE_MODULE is disabled, ignore
      if (typeof app.pm2_env.axm_options.isModule !== "undefined" && !ROTATE_MODULE) 
        return;
      
      // if apps instances are multi and the logs of instances are combined, ignore
      if (app.pm2_env.instances > 1 && has_same_logs(appMap[app.name], app)) 
        return;      

      appMap[app.name] = app;
      proceed_app(app, force);
    });
  });
}

