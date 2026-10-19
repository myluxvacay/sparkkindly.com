#!/usr/bin/env python3
"""Activate a reviewed SparkKindly export on the existing Caddy VPS.

Usage: python3 activate-public.py ARCHIVE --sha256 EXPECTED_SHA256
Run on the VPS as root, with sparkkindly-public.caddy next to this script.
No DNS, MongoDB, private preview, or MyLuxVacation route bodies are changed.
"""
import argparse
import datetime
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tarfile


def command(*args):
    subprocess.run(args, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--sha256', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run this command as root on the VPS.')
    archive = args.archive.resolve(strict=True)
    digest = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
    if digest != args.sha256.lower():
        raise RuntimeError('Archive checksum mismatch; nothing activated.')
    active = Path('/etc/caddy/Caddyfile')
    template = Path('/opt/myluxvacation/deploy/Caddyfile')
    original = active.read_bytes()
    if template.read_bytes() != original:
        raise RuntimeError('Active and deployment Caddyfiles differ. Reconcile before activation.')
    snippet_source = Path(__file__).resolve().with_name('sparkkindly-public.caddy')
    snippet = Path('/etc/caddy/sparkkindly-public.caddy')
    previous_snippet = snippet.read_bytes() if snippet.exists() else None
    public = Path('/var/www/sparkkindly/public')
    current = public / 'current'
    if current.exists() and not current.is_symlink():
        raise RuntimeError('The public current path is a real directory. Preserve it before proceeding.')
    previous_target = os.readlink(current) if current.is_symlink() else None
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    release = public / 'releases' / stamp
    release.mkdir(parents=True, mode=0o755)
    with tarfile.open(archive, 'r:gz') as bundle:
        for member in bundle.getmembers():
            parts = Path(member.name).parts
            if Path(member.name).is_absolute() or '..' in parts or member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
                raise RuntimeError('Unsafe archive entry; nothing activated.')
            if any(p.startswith('.env') for p in parts) or member.name.endswith(('.pem', '.key', '.users', '.hash')):
                raise RuntimeError('Credential-like file in archive; nothing activated.')
        bundle.extractall(release, filter='data')
    for path in [release, *release.rglob('*')]:
        path.chmod(0o755 if path.is_dir() else 0o644)
    index = release / 'index.html'
    robots = (release / 'robots.txt').read_text()
    if 'Allow: /' not in robots or 'Disallow: /' in robots:
        raise RuntimeError('Archive is not a public build; nothing activated.')
    if not index.is_file() or not (release / '404.html').is_file() or not (release / '_next').is_dir():
        raise RuntimeError('Incomplete static export; nothing activated.')
    command('runuser', '-u', 'caddy', '--', 'test', '-r', str(index))
    backup = Path('/etc/caddy/sparkkindly-backups') / stamp
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(active, backup / 'Caddyfile')
    shutil.copy2(template, backup / 'deployment-Caddyfile')
    if previous_snippet is not None:
        (backup / 'sparkkindly-public.caddy').write_bytes(previous_snippet)
    (backup / 'previous-public-target.txt').write_text((previous_target or '') + '\n')
    import_line = 'import /etc/caddy/sparkkindly-public.caddy'
    candidate_bytes = original if import_line in original.decode().splitlines() else original + ('\n' + import_line + '\n').encode()
    candidate = backup / 'candidate.Caddyfile'
    candidate.write_bytes(candidate_bytes)
    live_files_changed = False
    switched = False
    pending = public / f'.current-{stamp}'
    try:
        snippet.write_bytes(snippet_source.read_bytes())
        snippet.chmod(0o644)
        command('caddy', 'validate', '--config', str(candidate), '--adapter', 'caddyfile')
        pending.symlink_to(release)
        os.replace(pending, current)
        switched = True
        live_files_changed = True
        active.write_bytes(candidate_bytes)
        template.write_bytes(candidate_bytes)
        command('systemctl', 'reload', 'caddy')
        command('systemctl', 'is-active', '--quiet', 'caddy')
    except Exception:
        if live_files_changed:
            active.write_bytes(original)
            template.write_bytes(original)
        if previous_snippet is None:
            snippet.unlink(missing_ok=True)
        else:
            snippet.write_bytes(previous_snippet)
        if switched:
            if previous_target is None:
                current.unlink(missing_ok=True)
            else:
                pending.symlink_to(previous_target)
                os.replace(pending, current)
        if live_files_changed:
            subprocess.run(['systemctl', 'reload', 'caddy'], check=False)
        raise
    print(f'Public artifact installed at {release}')
    print(f'Caddy backups: {backup}')
    print('Caddy reloaded; the separate password-protected preview remains configured.')
    print('Next: point the domain DNS at the VPS, verify certificates/HTTPS and both websites.')
    print('Persist the added import in the MyLuxVacation deployment source repository.')


if __name__ == '__main__':
    main()
