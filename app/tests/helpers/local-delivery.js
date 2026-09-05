import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
export async function command(cwd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {cwd, env:{...process.env, ...env}, stdio:['ignore','pipe','pipe']});
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({code, output}));
  });
}
export async function unusedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
export async function localDelivery(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-delivery-'));
  const seed = path.join(root, 'seed'), remote = path.join(root, 'origin.git'), repo = path.join(root, 'boss');
  fs.mkdirSync(seed);
  for (const name of ['app','scripts','workbuddy','.gitignore']) {
    fs.cpSync(path.join(source, name), path.join(seed, name), {recursive:true, filter:p=>!/(?:^|\/)(?:node_modules|test-results|playwright-report)(?:\/|$)/.test(p)});
  }
  git(seed, 'init', '-b', 'main');
  git(seed, 'config', 'user.email', 'fixture@example.invalid');
  git(seed, 'config', 'user.name', 'Local delivery fixture');
  git(seed, 'add', '.'); git(seed, 'commit', '-m', 'fixture release A');
  git(root, 'clone', '--bare', seed, remote);
  git(root, 'clone', remote, repo);
  const port = await unusedPort(), data = path.join(repo, 'data');
  const env = {WORKBENCH_DATA_DIR:data, WORKBENCH_PORT:String(port), WORKBENCH_HOST:'127.0.0.1', WORKBENCH_GIT_SHA:'must-not-trust-env'};
  const cli = (action, extra = {}) => command(repo, [process.execPath, '--disable-warning=ExperimentalWarning', 'scripts/local-service.mjs', action], {...env,...extra});
  const script = (name, extra = {}) => command(repo, ['bash', `scripts/${name}-local.sh`], {...env,...extra});
  t.after(async () => {
    // The runtime's authenticated control channel stops only this fixture's service.
    const stopped=await cli('stop');
    if(stopped.code!==0 && fs.existsSync(path.join(data,'local-runtime/service.json')))throw new Error(`Fixture cleanup could not prove service stopped; retained ${root}`);
    fs.rmSync(root, {recursive:true, force:true});
  });
  return {root, seed, remote, repo, data, port, env, cli, script,
    read: name=>fs.readFileSync(path.join(data,name),'utf8'),
    health: async()=> (await (await fetch(`http://127.0.0.1:${port}/api/v1/health`)).json()).data,
    async remember() {
      const {token} = JSON.parse(fs.readFileSync(path.join(data,'secrets.json'),'utf8'));
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/inspirations`, {method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,'idempotency-key':'fixture-inspiration'},body:JSON.stringify({rawText:'TEMP only retained inspiration'})});
      if(!res.ok) throw new Error(`fixture write failed ${res.status}`);
      return (await res.json()).data;
    },
    release(files = {'release-marker.txt':'release B\n'}) {
      for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(seed,name),text);
      git(seed,'add','.'); git(seed,'commit','-m','fixture next release');
      git(seed,'push',remote,'main');
      return git(seed,'rev-parse','HEAD');
    }
  };
}
