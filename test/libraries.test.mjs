import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEnvironment } from '../src/browser.mjs';
import { libraryCommand, libraryReport, packageManager, parseLddMissing } from '../src/libraries.mjs';

const release = {
  ubuntu2404: 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\nUBUNTU_CODENAME=noble\n',
  ubuntu2310: 'PRETTY_NAME="Ubuntu 23.10"\nVERSION_ID="23.10"\nVERSION_CODENAME=mantic\nID=ubuntu\nID_LIKE=debian\nUBUNTU_CODENAME=mantic\n',
  ubuntu2204: 'PRETTY_NAME="Ubuntu 22.04.5 LTS"\nVERSION_ID="22.04"\nVERSION_CODENAME=jammy\nID=ubuntu\nID_LIKE=debian\nUBUNTU_CODENAME=jammy\n',
  mint22: 'PRETTY_NAME="Linux Mint 22"\nVERSION_ID="22"\nVERSION_CODENAME=wilma\nID=linuxmint\nID_LIKE="ubuntu debian"\nUBUNTU_CODENAME=noble\n',
  mint21: 'PRETTY_NAME="Linux Mint 21.3"\nVERSION_ID="21.3"\nVERSION_CODENAME=virginia\nID=linuxmint\nID_LIKE="ubuntu debian"\nUBUNTU_CODENAME=jammy\n',
  debian12: 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nVERSION_ID="12"\nVERSION_CODENAME=bookworm\nID=debian\n',
  debian13: 'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nVERSION_ID="13"\nVERSION_CODENAME=trixie\nID=debian\n',
  debianSid: 'PRETTY_NAME="Debian GNU/Linux forky/sid"\nID=debian\n',
  fedora: 'PRETTY_NAME="Fedora Linux 41"\nID=fedora\nVERSION_ID=41\n',
  rocky: 'PRETTY_NAME="Rocky Linux 9.4"\nID="rocky"\nID_LIKE="rhel centos fedora"\nVERSION_ID="9.4"\n',
  arch: 'PRETTY_NAME="Arch Linux"\nID=arch\n',
  manjaro: 'PRETTY_NAME="Manjaro Linux"\nID=manjaro\nID_LIKE=arch\n',
  suse: 'PRETTY_NAME="openSUSE Leap 15.6"\nID="opensuse-leap"\nID_LIKE="suse opensuse"\n',
  nixos: 'PRETTY_NAME="NixOS 24.11"\nID=nixos\n',
};
const environmentOf = name => detectEnvironment({ platform: 'linux', osRelease: release[name], procVersion: 'Linux version 6.8.0-45-generic', env: {} });

// What terminal-browser's bundled Electron engine reported as missing on an Ubuntu 24.04 WSL2 host.
const electron = ['libnspr4.so', 'libnss3.so', 'libnssutil3.so', 'libsmime3.so', 'libasound.so.2'];

test('parseLddMissing lists only the libraries ldd reports as not found, once each and sorted', () => {
  const output = '\tlinux-vdso.so.1 (0x00007ffd)\n\tlibnss3.so => not found\n\tlibasound.so.2 => not found\n\tlibnss3.so => not found\n\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f03)\n\tlibm.so.6 => /lib/libm.so.6 (0x1)\n\t/lib64/ld-linux-x86-64.so.2 (0x00007f04)\n';
  assert.deepEqual(parseLddMissing(output), ['libasound.so.2', 'libnss3.so']);
  assert.deepEqual(parseLddMissing('\tstatically linked\n'), []);
  assert.deepEqual(parseLddMissing(), []);
});

test('libraryCommand maps only the reported libraries and picks the right asound package for each apt release', () => {
  const command = (name, sonames = electron) => libraryCommand(environmentOf(name), sonames)?.command;
  assert.equal(command('ubuntu2404'), 'sudo apt-get update && sudo apt-get install -y libnspr4 libnss3 libasound2t64');
  assert.equal(command('ubuntu2204'), 'sudo apt-get update && sudo apt-get install -y libnspr4 libnss3 libasound2');
  assert.equal(command('ubuntu2310'), 'sudo apt-get update && sudo apt-get install -y libnspr4 libnss3 libasound2');
  assert.match(command('mint22'), /libasound2t64$/);
  assert.match(command('mint21'), /libasound2$/);
  assert.match(command('debian12'), /libasound2$/);
  assert.match(command('debian13'), /libasound2t64$/);
  assert.match(command('debianSid'), /libasound2t64$/);
  assert.equal(command('fedora'), 'sudo dnf install -y nspr nss alsa-lib');
  assert.equal(command('rocky'), 'sudo dnf install -y nspr nss alsa-lib');
  assert.equal(command('arch'), 'sudo pacman -S --needed nspr nss alsa-lib');
  assert.equal(command('manjaro'), 'sudo pacman -S --needed nspr nss alsa-lib');
  assert.equal(command('ubuntu2404', ['libnss3.so']), 'sudo apt-get update && sudo apt-get install -y libnss3', 'a library that was not reported is not listed');
  assert.equal(command('ubuntu2404', ['libgtk-3.so.0', 'libatk-1.0.so.0', 'libgbm.so.1']), 'sudo apt-get update && sudo apt-get install -y libgtk-3-0t64 libatk1.0-0t64 libgbm1');
  assert.equal(command('ubuntu2204', ['libgtk-3.so.0', 'libatk-1.0.so.0']), 'sudo apt-get update && sudo apt-get install -y libgtk-3-0 libatk1.0-0');
});

test('libraryCommand never guesses: unknown distributions and unmapped libraries get no command', () => {
  assert.equal(libraryCommand(environmentOf('nixos'), electron), null);
  assert.equal(libraryCommand(environmentOf('suse'), electron), null);
  assert.equal(libraryCommand({ distro: null }, electron), null);
  assert.equal(packageManager(environmentOf('nixos')), null);
  const partial = libraryCommand(environmentOf('fedora'), ['libnss3.so', 'libmystery.so.1']);
  assert.deepEqual([partial.command, partial.unmapped], ['sudo dnf install -y nss', ['libmystery.so.1']]);
  assert.equal(libraryCommand(environmentOf('fedora'), ['libmystery.so.1']).command, null);
});

// A fake ldd: `outputs` maps a binary path to what `ldd <path>` returns.
function fakeLdd(outputs, existing = []) {
  const calls = [];
  return { calls, exists: path => existing.includes(path), realpath: path => path,
    run: (command, args) => { calls.push([command, ...args]); return outputs[args[0]] ?? { status: 1, stdout: '', stderr: `ldd: ${args[0]}: No such file or directory\n` }; } };
}

test('libraryReport runs ldd on the binary, prints the install command for what is missing and never runs sudo', () => {
  const ubuntu = environmentOf('ubuntu2404');
  const missing = fakeLdd({ '/app/pixel': { status: 0, stdout: '\tlibnspr4.so => not found\n\tlibasound.so.2 => not found\n\tlibc.so.6 => /lib/libc.so.6 (0x1)\n' } });
  const report = libraryReport(missing, ubuntu, '/app/pixel');
  assert.deepEqual([report.status, report.missing, report.packages, report.command],
    ['missing', ['libasound.so.2', 'libnspr4.so'], ['libasound2t64', 'libnspr4'], 'sudo apt-get update && sudo apt-get install -y libasound2t64 libnspr4']);
  assert.deepEqual(missing.calls, [['ldd', '/app/pixel']]);

  const present = libraryReport(fakeLdd({ '/app/pixel': { status: 0, stdout: '\tlibc.so.6 => /lib/libc.so.6 (0x1)\n' } }), ubuntu, '/app/pixel');
  assert.deepEqual([present.status, present.missing, present.command, present.fallback], ['present', [], null, null]);

  const odd = libraryReport(fakeLdd({ '/app/pixel': { status: 0, stdout: '\tlibnss3.so => not found\n' } }), environmentOf('nixos'), '/app/pixel');
  assert.deepEqual([odd.status, odd.command], ['missing', null]);
  assert.match(odd.fallback, /Install the packages that provide libnss3\.so/);

  const unmapped = libraryReport(fakeLdd({ '/app/pixel': { status: 0, stdout: '\tlibmystery.so.1 => not found\n' } }), ubuntu, '/app/pixel');
  assert.match(unmapped.fallback, /No package name is known here for libmystery\.so\.1/);

  assert.equal(libraryReport(fakeLdd({}), { os: 'macos' }, '/x'), null);
  assert.equal(libraryReport(fakeLdd({}), { os: 'windows' }, '/x'), null);
});

test('libraryReport falls back to the real binary beside a vendor wrapper script and reports unknown when ldd cannot inspect anything', () => {
  const ubuntu = environmentOf('ubuntu2404');
  const outputs = { '/opt/google/chrome/google-chrome': { status: 1, stdout: '', stderr: '\tnot a dynamic executable\n' }, '/opt/google/chrome/chrome': { status: 0, stdout: '\tlibnss3.so => not found\n' } };
  const wrapped = libraryReport(fakeLdd(outputs, ['/opt/google/chrome/chrome']), ubuntu, '/opt/google/chrome/google-chrome');
  assert.deepEqual([wrapped.status, wrapped.binary, wrapped.missing], ['missing', '/opt/google/chrome/chrome', ['libnss3.so']]);

  const failing = libraryReport(fakeLdd({}), ubuntu, '/usr/bin/google-chrome');
  assert.deepEqual([failing.status, failing.command], ['unknown', null]);
  assert.match(failing.detail, /No such file/);
  const noLdd = libraryReport({ exists: () => false, realpath: path => path, run: () => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn ldd ENOENT'), { code: 'ENOENT' }) }) }, ubuntu, '/x/browser');
  assert.equal(noLdd.detail, 'ldd is not installed');
});
