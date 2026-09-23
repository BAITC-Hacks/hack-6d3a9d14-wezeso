import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const go=existsSync('.tools/go/bin/go.exe')?resolve('.tools/go/bin/go.exe'):'go';
const result=spawnSync(go,['test','-v','./...'],{cwd:resolve('backend'),stdio:'inherit',env:{...process.env,GOCACHE:resolve('.tools/go-cache')}});
process.exitCode=result.status??1;
