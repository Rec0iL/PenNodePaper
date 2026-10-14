import { describe, expect, it } from 'vitest';
import { resolveCli, shimTarget, type Env } from '../src/cli.js';

// What `npm install -g @openai/codex` writes (npm 7+), shortened to the lines that matter.
const NPM_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*
`;

const NPM = 'C:\\Users\\Mia\\AppData\\Roaming\\npm';
function win(files: Record<string, string>, path = `C:\\Windows\\system32;${NPM}`): Env {
  const has = new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]));
  return { platform: 'win32', path, pathExt: '.COM;.EXE;.BAT;.CMD', nodeExe: 'C:\\nodejs\\node.exe', exists: (p) => has.has(p.toLowerCase()), read: (p) => has.get(p.toLowerCase()) ?? '' };
}

describe('starting the AI programs', () => {
  it('reads what an npm launcher starts', () => {
    expect(shimTarget(NPM_SHIM)).toBe('node_modules\\@openai\\codex\\bin\\codex.js');
    expect(shimTarget('@ECHO off\r\n"%~dp0\\node.exe"  "%~dp0\\node_modules\\x\\bin\\x.js" %*')).toBe('node_modules\\x\\bin\\x.js');
    expect(shimTarget('@echo off\r\nsomething else')).toBeNull();
  });

  it('on Windows: codex.cmd (what npm installs) is found and run through node, with the prompt untouched', () => {
    const env = win({ [`${NPM}\\codex`]: '#!/bin/sh', [`${NPM}\\codex.cmd`]: NPM_SHIM, [`${NPM}\\codex.ps1`]: '' });
    const args = ['exec', '--json', '-c', 'mcp_servers.pennodepaper.url="http://127.0.0.1:4317/mcp?actor=codex"'];
    expect(resolveCli('codex', args, env)).toEqual({
      command: 'C:\\nodejs\\node.exe',
      args: [`${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`, ...args],
    });
  });

  it('on Windows: a real .exe wins and is started as it is', () => {
    const env = win({ 'C:\\Users\\Mia\\.local\\bin\\claude.exe': '' }, 'C:\\Users\\Mia\\.local\\bin;' + NPM);
    expect(resolveCli('claude', ['-p', 'a "quoted"\nprompt'], env)).toEqual({ command: 'C:\\Users\\Mia\\.local\\bin\\claude.exe', args: ['-p', 'a "quoted"\nprompt'] });
  });

  it('on Windows: a launcher pointing at an .exe is run directly; one it cannot read is only run for plain arguments', () => {
    const exeShim = '@ECHO off\r\n"%dp0%\\node_modules\\pkg\\bin\\tool.exe" %*';
    expect(resolveCli('tool', ['--version'], win({ [`${NPM}\\tool.cmd`]: exeShim }))).toEqual({ command: `${NPM}\\node_modules\\pkg\\bin\\tool.exe`, args: ['--version'] });
    const odd = win({ [`${NPM}\\odd.cmd`]: '@echo off\r\nrun-something' });
    expect(resolveCli('odd', ['--version'], odd).args).toEqual(['/d', '/c', `${NPM}\\odd.cmd`, '--version']);
    expect(() => resolveCli('odd', ['-p', 'hello & world'], odd)).toThrow(/cannot take this request safely/);
  });

  it('not found, or not Windows: the plain name, so the usual "could not start" message appears', () => {
    expect(resolveCli('codex', ['x'], win({}))).toEqual({ command: 'codex', args: ['x'] });
    expect(resolveCli('codex', ['x'], { ...win({}), platform: 'linux' })).toEqual({ command: 'codex', args: ['x'] });
  });
});
