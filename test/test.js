let MBout = '';
let MBerr = '';

for (let i = 0; i < 1024 * 1024; ++i)
  MBout += 'o';

for (let i = 0; i < 1024 * 1024; ++i)
  MBerr += 'e';

setInterval(function() {
  process.stdout.write(MBout);
  process.stderr.write(MBerr);
}, 1000);
