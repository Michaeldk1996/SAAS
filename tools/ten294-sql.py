#!/usr/bin/env python3
"""TEN-294 — run a list of SQL statements against Supabase via the Management API.

Used for the drops_api install, its read-only verification, and the watchdog install. Results are
ENCRYPTED to tools/ten294-pub.pem before upload (this repo is public; Bet105 prices
are partner-granted data). The log carries statement names, HTTP status and row
counts only — never rows, never a secret.
"""
import json, os, subprocess, sys, urllib.error, urllib.parse, urllib.request

url = os.environ["SUPABASE_URL"].rstrip("/")
ref = (urllib.parse.urlparse(url).hostname or "").split(".")[0]
print(f"::add-mask::{ref}")
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]


def sql(q):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{ref}/database/query",
                                 method="POST", data=json.dumps({"query": q}).encode())
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:  # timeout / network: report it as a failed step, never crash before the artifact
        return 599, json.dumps({"client_error": type(e).__name__})


def main():
    steps = json.load(open(os.environ["TEN294_STEPS"]))
    out, failed = {}, False
    for st in steps:
        if "sleep" in st:
            import time; time.sleep(st["sleep"]); continue
        if "vault_from_env" in st:
            # value -> Vault under the bot's OWN name; never printed, never in the artifact
            val = os.environ.get(st["vault_from_env"], "")
            if not val:
                print(f"{st['name']}: {st['vault_from_env']} not set"); failed = True; break
            tag = "v" + os.urandom(6).hex()
            q = (f"delete from vault.secrets where name = '{st['vault_name']}'; "
                 f"select vault.create_secret(${tag}${val}${tag}$, '{st['vault_name']}', 'TEN-294 drops') is not null as stored")
        elif "sql_files" in st:
            # one statement batch, one transaction: install + self-test + gate commit together or not at all
            body = "\n".join(open(f).read() for f in st["sql_files"]) + "\n" + st.get("sql_tail", "")
            q = ("begin;\n" + body + "\ncommit;\nselect 'committed' as result;") if st.get("transaction") else body
        else:
            q = st["sql"] if "sql" in st else open(st["file"]).read()
        code, body = sql(q)
        try:
            rows = json.loads(body)
        except ValueError:
            rows = body
        n = len(rows) if isinstance(rows, list) else "-"
        print(f"{st['name']}: HTTP {code} rows {n}")
        if code >= 400 and "vault_from_env" not in st:
            print("   error:", str(rows)[:300])
        elif code >= 400:
            print("   error: (withheld — the statement carried a secret)")
        if code >= 400 and st.get("required", False):
            failed = True   # a failed required step turns the run red
        out[st["name"]] = {"status": code, "rows": rows if "vault_from_env" not in st else "(withheld)"}
        if code >= 400 and st.get("stop_on_error"):
            break
    os.makedirs("out", exist_ok=True)
    json.dump(out, open("out/result.json", "w"), default=str)
    # hybrid encryption: random pass -> AES-256 file; pass -> RSA(pub)
    pw = os.urandom(32).hex()
    subprocess.run(["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-in", "out/result.json",
                    "-out", "out/result.enc", "-pass", "pass:" + pw], check=True)
    subprocess.run(["openssl", "pkeyutl", "-encrypt", "-pubin", "-inkey", "tools/ten294-pub.pem",
                    "-out", "out/pass.enc"], input=pw.encode(), check=True)
    os.remove("out/result.json")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
