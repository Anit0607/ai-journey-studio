"""Run only after owner approval and authorized DB setup. Never send password to chat."""
import getpass
import json
import subprocess
import sys
import warnings
from pathlib import Path

def main():
    if "--owner-setup-authorized" not in sys.argv or not sys.stdin.isatty():
        raise SystemExit("Owner-approved interactive hidden input is required.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        try:
            password=getpass.getpass("Choose owner password (hidden): ")
            if password!=getpass.getpass("Repeat owner password (hidden): "):
                raise SystemExit("Passwords did not match; nothing was written.")
        except getpass.GetPassWarning:
            raise SystemExit("Hidden input unavailable; nothing was written.")
    root=Path(__file__).resolve().parent.parent
    # DB credentials, if authorized, stay in the owner's process environment.
    # The password travels over a private child stdin pipe, never command args.
    result=subprocess.run(["node",str(root/"node_modules/tsx/dist/cli.mjs"),"scripts/owner-password-setup.ts","--owner-setup-authorized"],input=json.dumps({"password":password}),text=True,cwd=root)
    password=""
    return result.returncode

if __name__=="__main__":raise SystemExit(main())
