#!/usr/bin/env python3
"""A throwaway Postgres for the Pinnacle archive tests: initdb into a temp dir, start on a private socket, psql helpers,
stop + delete on close(). No Postgres binaries → `available()` is False and the caller SKIPS out loud (never a pass)."""
import glob, os, pwd, shutil, subprocess, tempfile

MIG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'supabase', 'migrations', '20261014120000_pinnacle_archive.sql')


def _bin():
    bins = sorted(glob.glob('/usr/lib/postgresql/*/bin/initdb')) + sorted(glob.glob('/opt/homebrew/opt/postgresql*/bin/initdb')) \
        + ([shutil.which('initdb')] if shutil.which('initdb') else [])
    return os.path.dirname(bins[-1]) if bins else None


class PG:
    def __init__(self):
        self.bin = _bin()
        self.as_pg = []
        self.why = None
        if not self.bin:
            self.why = 'no Postgres binaries on this machine'; return
        if os.geteuid() == 0:                       # initdb refuses root; run the cluster as the postgres user
            try: pwd.getpwnam('postgres'); self.as_pg = ['su', 'postgres', '-c']
            except KeyError: self.bin = None; self.why = 'root without a postgres user'; return
        self.tmp = tempfile.mkdtemp(prefix='pinarch-'); os.chmod(self.tmp, 0o777)
        self.data, self.port = os.path.join(self.tmp, 'data'), str(54000 + os.getpid() % 900)
        r = self.sh(f'{self.bin}/initdb -D {self.data} -A trust -U postgres >/dev/null && {self.bin}/pg_ctl -D {self.data} '
                    f'-o "-p {self.port} -k {self.tmp} -c listen_addresses=" -l {self.tmp}/log -w start >/dev/null')
        if r.returncode:
            raise RuntimeError('could not start a throwaway Postgres: ' + r.stderr[-400:])
        self.psql = shutil.which('psql') or os.path.join(self.bin, 'psql')

    def available(self):
        return bool(self.bin)

    def sh(self, cmd):
        full = self.as_pg + [cmd] if self.as_pg else ['bash', '-c', cmd]
        return subprocess.run(full, capture_output=True, text=True)

    def q(self, sql, role=None, db='postgres'):
        pre = f'set role {role}; ' if role else ''
        p = subprocess.run([self.psql, '-h', self.tmp, '-p', self.port, '-U', 'postgres', '-d', db, '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
                            '-c', pre + sql], capture_output=True, text=True)
        return p.returncode, (p.stdout + p.stderr).strip()

    def file(self, path, db='postgres'):
        p = subprocess.run([self.psql, '-h', self.tmp, '-p', self.port, '-U', 'postgres', '-d', db, '-q', '-v', 'ON_ERROR_STOP=1', '-f', path],
                           capture_output=True, text=True)
        return p.returncode, p.stderr

    def roles(self, db='postgres'):
        self.q("do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;"
               "do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;"
               "do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;", db=db)

    def close(self):
        if self.bin:
            self.sh(f'{self.bin}/pg_ctl -D {self.data} -m immediate stop >/dev/null 2>&1')
            shutil.rmtree(self.tmp, ignore_errors=True)
