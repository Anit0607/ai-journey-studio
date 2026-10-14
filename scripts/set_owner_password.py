"""Run only after owner approval and authorized DB setup. Never send password to chat."""
import getpass
import json
import os
import subprocess
import sys
import warnings
from pathlib import Path

def main():
    if "--owner-setup-authorized" not in sys.argv or not sys.stdin.isatty():
        raise SystemExit("Owner-approved interactive hidden input is required.")
    remote="--remote" in sys.argv
    if remote and "--migrate-authorized" not in sys.argv:
        raise SystemExit("Remote schema migration needs separate action-time approval.")
    database_url=""
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        try:
            if remote:
                database_url=getpass.getpass("Approved Neon connection string (hidden): ")
            password=getpass.getpass("Choose owner password (hidden): ")
            if password!=getpass.getpass("Repeat owner password (hidden): "):
                raise SystemExit("Passwords did not match; nothing was written.")
        except getpass.GetPassWarning:
            raise SystemExit("Hidden input unavailable; nothing was written.")
        except (EOFError, KeyboardInterrupt):
            raise SystemExit("Owner setup cancelled; nothing was written.") from None
    root=Path(__file__).resolve().parent.parent
    # Read only OS necessities, never inherited provider/config/proxy secrets.
    environment={name:os.environ[name] for name in ("PATH","PATHEXT","SYSTEMROOT","WINDIR","COMSPEC","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME") if name in os.environ}
    command=["node",str(root/"node_modules/tsx/dist/cli.mjs"),"scripts/owner-password-setup.ts","--owner-setup-authorized"]
    if remote:
        command.extend(["--remote","--migrate-authorized"])
    else:
        environment.update({"STUDIO_LOCAL_DB":"1","STUDIO_DATABASE_AUTHORIZED":"0"})
    try:
        result=subprocess.run(command,input=json.dumps({"password":password,"database_url":database_url}),text=True,cwd=root,env=environment)
        return result.returncode
    except (OSError, subprocess.SubprocessError, KeyboardInterrupt):
        raise SystemExit("Owner setup did not complete; no password or connection details were logged.") from None
    finally:
        password="";database_url=""

if __name__=="__main__":raise SystemExit(main())
